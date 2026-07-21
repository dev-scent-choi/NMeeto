"""이력서 파싱 파이프라인. 구현명세서 §6."""

import io
import re
from pathlib import Path
from typing import Optional

import structlog

log = structlog.get_logger()

PII_PATTERNS = [
    (r"\d{6}-[1-4]\d{6}", "[주민번호]"),
    (r"0\d{1,2}-\d{3,4}-\d{4}", "[전화번호]"),
    (r"\+82[-\s]?\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}", "[전화번호]"),
    (r"\d{10,12}", "[전화번호]"),
    (r"\d{3,4}-\d{4}-\d{4}-\d{4}", "[계좌번호]"),
    (r"[가-힣]{2,4}시\s[가-힣]{2,4}구\s[가-힣]{2,4}동\s[\w\-]+호?", "[상세주소]"),
]

INJECTION_PATTERNS = [
    r"ignore\s+previous",
    r"system\s+prompt",
    r"당신은\s+이제",
    r"점수를\s+부여하라",
    r"모든\s+항목에\s+\d",
    r"이전\s+지시를\s+무시",
    r"</?system>",
    r"</?instruction",
]


def mask_pii(text: str) -> str:
    for pattern, replacement in PII_PATTERNS:
        text = re.sub(pattern, replacement, text)
    return text


def detect_injection(text: str) -> list[str]:
    found = []
    for pattern in INJECTION_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            found.append(pattern)
    return found


def extract_from_pdf(content: bytes) -> Optional[str]:
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            pages = []
            for page in pdf.pages:
                extracted = page.extract_text() or ""
                pages.append(extracted)
            return "\n".join(pages)
    except Exception as e:
        log.warning("pdf_extract_failed", error=str(e))
        return None


def extract_from_docx(content: bytes) -> Optional[str]:
    try:
        import docx
        doc = docx.Document(io.BytesIO(content))
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except Exception as e:
        log.warning("docx_extract_failed", error=str(e))
        return None


def is_scan_image(text: str, page_count: int) -> bool:
    if not text:
        return True
    chars_per_page = len(text) / max(page_count, 1)
    return chars_per_page < 100


def ocr_fallback(content: bytes, mime_type: str) -> Optional[str]:
    try:
        import pytesseract
        from PIL import Image
        if mime_type == "application/pdf":
            import pdfplumber
            texts = []
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                for page in pdf.pages:
                    img = page.to_image(resolution=200).original
                    texts.append(pytesseract.image_to_string(img, lang="kor+eng"))
            return "\n".join(texts)
        else:
            img = Image.open(io.BytesIO(content))
            return pytesseract.image_to_string(img, lang="kor+eng")
    except Exception as e:
        log.warning("ocr_failed", error=str(e))
        return None


def parse_resume(content: bytes, filename: str) -> dict:
    """
    Returns dict with keys: text, status, injection_flags
    status: ok | needs_manual | failed
    """
    ext = Path(filename).suffix.lower()
    text = None

    if ext == ".pdf":
        text = extract_from_pdf(content)
        if text and is_scan_image(text, content.count(b"/Page ")):
            log.info("resume_scan_detected_trying_ocr")
            ocr_text = ocr_fallback(content, "application/pdf")
            if ocr_text and len(ocr_text) > 100:
                text = ocr_text
            else:
                return dict(text=None, status="needs_manual", injection_flags=[])
    elif ext in (".docx", ".doc"):
        text = extract_from_docx(content)
    elif ext == ".txt":
        text = content.decode("utf-8", errors="replace")
    else:
        return dict(text=None, status="failed", injection_flags=[])

    if not text or len(text.strip()) < 50:
        return dict(text=None, status="needs_manual", injection_flags=[])

    text = mask_pii(text)
    injection_flags = detect_injection(text)

    if injection_flags:
        log.warning("injection_patterns_detected", patterns=injection_flags)

    return dict(text=text, status="ok", injection_flags=injection_flags)
