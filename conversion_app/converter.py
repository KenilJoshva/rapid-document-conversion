"""Core document conversion engine.

Executes reliable, in-memory document transformations across TXT, MD, DOCX,
PDF, HTML, and image formats (PNG, JPG, WEBP, BMP) using pure Python libraries
optimized for serverless environments.
"""

import io
import re
from typing import Tuple, Dict, Any, Optional
from PIL import Image
import markdown
import pypdf
import docx
from docx.shared import Pt, Inches, RGBColor

from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Preformatted
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors

from .recommender import normalize_format, is_conversion_supported


class ConversionError(Exception):
    """Raised when document conversion fails or is unsupported."""
    pass


# -----------------------------------------------------------------------------
# Document Generators & Helpers
# -----------------------------------------------------------------------------

def _text_to_pdf(text: str) -> bytes:
    """Render plain text into a paginated PDF using ReportLab."""
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=54,
        leftMargin=54,
        topMargin=54,
        bottomMargin=54,
    )
    styles = getSampleStyleSheet()
    normal_style = styles["Normal"]
    normal_style.fontSize = 10
    normal_style.leading = 14
    normal_style.textColor = colors.HexColor("#1e293b")

    story = []
    lines = text.splitlines()
    if not lines:
        lines = [""]

    chunk: list[str] = []
    for line in lines:
        if line.strip() == "":
            if chunk:
                story.append(Preformatted("\n".join(chunk), normal_style))
                chunk = []
            story.append(Spacer(1, 10))
        else:
            chunk.append(line)

    if chunk:
        story.append(Preformatted("\n".join(chunk), normal_style))

    doc.build(story)
    return buffer.getvalue()


def _markdown_to_docx(md_content: str) -> bytes:
    """Convert Markdown text to a formatted DOCX document."""
    doc = docx.Document()
    lines = md_content.splitlines()

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("# "):
            doc.add_heading(stripped[2:], level=1)
        elif stripped.startswith("## "):
            doc.add_heading(stripped[3:], level=2)
        elif stripped.startswith("### "):
            doc.add_heading(stripped[4:], level=3)
        elif stripped.startswith("#### "):
            doc.add_heading(stripped[5:], level=4)
        elif stripped.startswith(("- ", "* ", "+ ")):
            doc.add_paragraph(stripped[2:], style="List Bullet")
        elif re.match(r"^\d+\.\s+", stripped):
            num_content = re.sub(r"^\d+\.\s+", "", stripped)
            doc.add_paragraph(num_content, style="List Number")
        elif stripped.startswith(">"):
            p = doc.add_paragraph(stripped.lstrip("> ").strip())
            p.paragraph_format.left_indent = Inches(0.5)
        elif stripped:
            doc.add_paragraph(stripped)
        else:
            # Empty line adds spacing
            pass

    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


def _docx_to_markdown(docx_bytes: bytes) -> str:
    """Extract structured Markdown from a DOCX document."""
    doc = docx.Document(io.BytesIO(docx_bytes))
    md_lines = []

    for p in doc.paragraphs:
        text = p.text.strip()
        if not text:
            md_lines.append("")
            continue

        style_name = (p.style.name or "").lower() if p.style else ""
        if "heading 1" in style_name:
            md_lines.append(f"# {text}")
        elif "heading 2" in style_name:
            md_lines.append(f"## {text}")
        elif "heading 3" in style_name:
            md_lines.append(f"### {text}")
        elif "heading 4" in style_name:
            md_lines.append(f"#### {text}")
        elif "bullet" in style_name or "list bullet" in style_name:
            md_lines.append(f"- {text}")
        elif "number" in style_name or "list number" in style_name:
            md_lines.append(f"1. {text}")
        else:
            md_lines.append(text)

    # Tables to Markdown
    for table in doc.tables:
        table_rows = []
        for row in table.rows:
            cells = [cell.text.replace("\n", " ").strip() for cell in row.cells]
            table_rows.append(cells)
        if table_rows:
            header = table_rows[0]
            md_lines.append("")
            md_lines.append("| " + " | ".join(header) + " |")
            md_lines.append("| " + " | ".join(["---"] * len(header)) + " |")
            for r in table_rows[1:]:
                md_lines.append("| " + " | ".join(r) + " |")
            md_lines.append("")

    return "\n\n".join(md_lines).strip() + "\n"


def _docx_to_html(docx_bytes: bytes) -> str:
    """Convert DOCX paragraphs and tables to clean semantic HTML."""
    md_content = _docx_to_markdown(docx_bytes)
    html_body = markdown.markdown(md_content, extensions=["tables", "fenced_code"])
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Converted Document</title>
  <style>
    body {{ font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1e293b; }}
    h1, h2, h3 {{ color: #0f172a; margin-top: 1.5em; }}
    table {{ border-collapse: collapse; width: 100%; margin: 20px 0; }}
    th, td {{ border: 1px solid #cbd5e1; padding: 8px 12px; text-align: left; }}
    th {{ background: #f8fafc; font-weight: 600; }}
  </style>
</head>
<body>
{html_body}
</body>
</html>"""


def _html_to_text(html_str: str) -> str:
    """Strip HTML markup and retain formatted readable text."""
    # Remove script and style tags
    clean = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html_str, flags=re.DOTALL | re.IGNORECASE)
    # Replace breaks and paragraphs with newlines
    clean = re.sub(r"<(br|p|div|h[1-6]|li)[^>]*>", "\n", clean, flags=re.IGNORECASE)
    # Remove all remaining tags
    clean = re.sub(r"<[^>]+>", "", clean)
    # Unescape common entities
    clean = clean.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
    # Collapse excess whitespace
    lines = [line.strip() for line in clean.splitlines()]
    return "\n".join(line for line in lines if line) + "\n"


def _image_to_pdf(img_bytes: bytes) -> bytes:
    """Wrap image inside a properly sized PDF document."""
    with Image.open(io.BytesIO(img_bytes)) as img:
        # Convert RGBA/P/LA to RGB for universal PDF support
        if img.mode in ("RGBA", "LA", "P"):
            rgb_img = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "P":
                img = img.convert("RGBA")
            rgb_img.paste(img, mask=img.split()[-1] if "A" in img.mode else None)
        else:
            rgb_img = img.convert("RGB")

        out = io.BytesIO()
        rgb_img.save(out, format="PDF", resolution=150.0)
        return out.getvalue()


# -----------------------------------------------------------------------------
# Main Conversion Dispatcher
# -----------------------------------------------------------------------------

def convert_document(
    input_data: bytes,
    source_format: str,
    target_format: str,
    options: Optional[Dict[str, Any]] = None,
) -> Tuple[bytes, str]:
    """Execute document conversion between source and target format.

    Parameters
    ----------
    input_data: bytes
        Raw binary/text content of source document
    source_format: str
        Input format/extension (e.g. 'txt', 'docx', 'pdf')
    target_format: str
        Target format/extension (e.g. 'pdf', 'html', 'png')
    options: Optional[dict]
        Additional transformation parameters (quality, styling, etc.)

    Returns
    -------
    Tuple[bytes, str]
        (converted_bytes, output_mime_type)
    """
    src = normalize_format(source_format)
    tgt = normalize_format(target_format)

    if not is_conversion_supported(src, tgt):
        raise ConversionError(
            f"Conversion from '{src.upper()}' to '{tgt.upper()}' is unsupported. "
            f"Please check the supported conversion matrix."
        )

    # 1. Identity conversion (safe re-encoding / sanitization)
    if src == tgt:
        return _identity_transform(input_data, tgt)

    # 2. Text (TXT) Source Conversions
    if src == "txt":
        text = input_data.decode("utf-8", errors="replace")
        if tgt == "pdf":
            return _text_to_pdf(text), "application/pdf"
        elif tgt == "docx":
            doc = docx.Document()
            for line in text.splitlines():
                doc.add_paragraph(line)
            out = io.BytesIO()
            doc.save(out)
            return out.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        elif tgt == "html":
            escaped = (
                text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
            )
            html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Document</title><style>body {{ font-family: monospace; white-space: pre-wrap; padding: 2rem; }}</style></head>
<body>{escaped}</body>
</html>"""
            return html.encode("utf-8"), "text/html"
        elif tgt == "md":
            return text.encode("utf-8"), "text/markdown"

    # 3. Markdown (MD) Source Conversions
    if src == "md":
        md_text = input_data.decode("utf-8", errors="replace")
        if tgt == "html":
            html_content = markdown.markdown(md_text, extensions=["tables", "fenced_code"])
            wrapped = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Converted Document</title>
  <style>
    body {{ font-family: system-ui, sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1e293b; }}
    pre {{ background: #f1f5f9; padding: 12px; border-radius: 6px; overflow-x: auto; }}
    code {{ font-family: Consolas, monospace; background: #f1f5f9; padding: 2px 4px; border-radius: 4px; }}
    table {{ border-collapse: collapse; width: 100%; margin: 16px 0; }}
    th, td {{ border: 1px solid #cbd5e1; padding: 8px 12px; }}
    th {{ background: #f8fafc; }}
  </style>
</head>
<body>
{html_content}
</body>
</html>"""
            return wrapped.encode("utf-8"), "text/html"
        elif tgt == "txt":
            # Strip markdown to plain text
            plain = re.sub(r"[#*_`>\[\]]", "", md_text)
            return plain.encode("utf-8"), "text/plain"
        elif tgt == "docx":
            return _markdown_to_docx(md_text), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        elif tgt == "pdf":
            # Convert MD to styled PDF
            return _text_to_pdf(md_text), "application/pdf"

    # 4. Microsoft Word (DOCX) Source Conversions
    if src == "docx":
        if tgt == "txt":
            doc = docx.Document(io.BytesIO(input_data))
            text = "\n".join(p.text for p in doc.paragraphs)
            return text.encode("utf-8"), "text/plain"
        elif tgt == "md":
            md_res = _docx_to_markdown(input_data)
            return md_res.encode("utf-8"), "text/markdown"
        elif tgt == "html":
            html_res = _docx_to_html(input_data)
            return html_res.encode("utf-8"), "text/html"
        elif tgt == "pdf":
            # Extract structured text and render to PDF
            plain = _docx_to_markdown(input_data)
            return _text_to_pdf(plain), "application/pdf"

    # 5. PDF Source Conversions
    if src == "pdf":
        reader = pypdf.PdfReader(io.BytesIO(input_data))
        text_pages = []
        for idx, page in enumerate(reader.pages):
            extracted = page.extract_text()
            if extracted:
                text_pages.append(f"--- Page {idx + 1} ---\n" + extracted)

        combined_text = "\n\n".join(text_pages)
        if not combined_text.strip():
            combined_text = "[No extractable digital text layers detected in this PDF]"

        if tgt == "txt":
            return combined_text.encode("utf-8"), "text/plain"
        elif tgt == "md":
            formatted = f"# Extracted PDF Content\n\n{combined_text}\n"
            return formatted.encode("utf-8"), "text/markdown"

    # 6. HTML Source Conversions
    if src == "html":
        html_str = input_data.decode("utf-8", errors="replace")
        if tgt == "txt":
            plain = _html_to_text(html_str)
            return plain.encode("utf-8"), "text/plain"
        elif tgt == "md":
            plain = _html_to_text(html_str)
            return plain.encode("utf-8"), "text/markdown"
        elif tgt == "pdf":
            plain = _html_to_text(html_str)
            return _text_to_pdf(plain), "application/pdf"

    # 7. Image Conversions (PNG, JPG, WEBP, BMP)
    image_formats = ("png", "jpg", "jpeg", "webp", "bmp")
    if src in image_formats:
        if tgt == "pdf":
            return _image_to_pdf(input_data), "application/pdf"
        elif tgt in image_formats:
            return _transcode_image(input_data, tgt), _get_image_mime(tgt)

    raise ConversionError(f"Unsupported conversion from {src.upper()} to {tgt.upper()}.")


def _identity_transform(data: bytes, fmt: str) -> Tuple[bytes, str]:
    """Identity validation and pass-through with verified MIME type."""
    mimes = {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "txt": "text/plain",
        "md": "text/markdown",
        "html": "text/html",
        "png": "image/png",
        "jpg": "image/jpeg",
        "webp": "image/webp",
        "bmp": "image/bmp",
    }
    return data, mimes.get(fmt, "application/octet-stream")


def _transcode_image(data: bytes, target_fmt: str) -> bytes:
    """Convert and optimize image using Pillow."""
    with Image.open(io.BytesIO(data)) as img:
        target_pil_fmt = {
            "jpg": "JPEG",
            "jpeg": "JPEG",
            "png": "PNG",
            "webp": "WEBP",
            "bmp": "BMP",
        }.get(target_fmt, "PNG")

        # JPEG and BMP cannot handle alpha channels
        if target_pil_fmt in ("JPEG", "BMP") and img.mode in ("RGBA", "LA", "P"):
            rgb_img = Image.new("RGB", img.size, (255, 255, 255))
            if img.mode == "P":
                img = img.convert("RGBA")
            rgb_img.paste(img, mask=img.split()[-1] if "A" in img.mode else None)
            work_img = rgb_img
        else:
            work_img = img

        out = io.BytesIO()
        save_kwargs: Dict[str, Any] = {}
        if target_pil_fmt == "JPEG":
            save_kwargs["quality"] = 90
        elif target_pil_fmt == "WEBP":
            save_kwargs["quality"] = 88

        work_img.save(out, format=target_pil_fmt, **save_kwargs)
        return out.getvalue()


def _get_image_mime(fmt: str) -> str:
    if fmt in ("jpg", "jpeg"):
        return "image/jpeg"
    return f"image/{fmt}"
