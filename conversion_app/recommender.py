"""Intelligent format recommendation engine.

Analyzes input formats and user intent to suggest the best output format
and maintains the authoritative conversion support matrix.
"""

from typing import Dict, List, Any, Optional

# Authoritative conversion matrix: input_format -> list of supported output_formats
SUPPORTED_CONVERSIONS: Dict[str, List[str]] = {
    "txt": ["pdf", "docx", "html", "md"],
    "md": ["pdf", "docx", "html", "txt"],
    "docx": ["txt", "md", "html", "pdf"],
    "pdf": ["txt", "md"],
    "html": ["txt", "md", "pdf"],
    "png": ["jpg", "webp", "pdf", "bmp"],
    "jpg": ["png", "webp", "pdf", "bmp"],
    "jpeg": ["png", "webp", "pdf", "bmp"],
    "webp": ["png", "jpg", "pdf", "bmp"],
    "bmp": ["png", "jpg", "webp", "pdf"],
}

# User goal definitions and target format priorities
GOAL_PREFERENCES: Dict[str, List[str]] = {
    "share_print": ["pdf", "html"],
    "editing": ["docx", "md", "txt"],
    "web_publishing": ["html", "webp", "png", "md"],
    "lightweight_text": ["txt", "md"],
    "archival": ["pdf", "png"],
}

GOAL_DESCRIPTIONS: Dict[str, str] = {
    "share_print": "Preserve layout, fonts, and appearance across devices for printing or formal sharing.",
    "editing": "Generate a format that can be easily modified in office or text editors.",
    "web_publishing": "Generate web-ready markup or optimized images suitable for browser viewing.",
    "lightweight_text": "Extract pure plain text or markdown for minimal size, indexing, or parsing.",
    "archival": "Create a stable, standardized, long-term readable output.",
}


def normalize_format(fmt: Optional[str]) -> str:
    """Normalize file extension/format string (e.g. '.PDF' -> 'pdf')."""
    if not fmt:
        return ""
    cleaned = fmt.strip().lower()
    if cleaned.startswith("."):
        cleaned = cleaned[1:]
    if cleaned == "jpeg":
        return "jpg"
    return cleaned


def is_conversion_supported(source_format: str, target_format: str) -> bool:
    """Check if conversion from source_format to target_format is supported."""
    src = normalize_format(source_format)
    tgt = normalize_format(target_format)
    if src == tgt:
        return True  # Re-encoding / sanitizing same format
    allowed = SUPPORTED_CONVERSIONS.get(src, [])
    return tgt in allowed


def get_supported_targets(source_format: str) -> List[str]:
    """Return all target formats supported for a given input format."""
    src = normalize_format(source_format)
    targets = list(SUPPORTED_CONVERSIONS.get(src, []))
    if src and src not in targets:
        targets.insert(0, src)
    return targets


def recommend_format(source_format: str, goal: Optional[str] = None) -> Dict[str, Any]:
    """Recommend an output format based on source format and user goal.

    Parameters
    ----------
    source_format: str
        The input document extension/format (e.g., 'txt', 'docx', 'png')
    goal: Optional[str]
        User's desired objective ('share_print', 'editing', 'web_publishing',
        'lightweight_text', 'archival')

    Returns
    -------
    dict
        Recommendation details including primary recommendation, explanation,
        alternatives, and all supported targets.
    """
    src = normalize_format(source_format)
    targets = SUPPORTED_CONVERSIONS.get(src, [])

    if not targets:
        return {
            "source_format": src,
            "recommended_format": None,
            "reason": f"Source format '{src}' is not currently supported for automated conversion.",
            "confidence": "none",
            "supported_targets": [],
            "alternative_options": [],
        }

    selected_goal = (goal or "").lower().strip()
    if selected_goal not in GOAL_PREFERENCES:
        # Default heuristics when no specific goal is selected
        if src in ("txt", "md", "docx"):
            selected_goal = "share_print"
        elif src == "pdf":
            selected_goal = "editing"
        else:
            selected_goal = "web_publishing"

    preferred_candidates = GOAL_PREFERENCES.get(selected_goal, [])

    # Find the highest priority preferred format that is supported for this source
    recommended = None
    for cand in preferred_candidates:
        if cand in targets and cand != src:
            recommended = cand
            break

    if not recommended:
        # Fall back to first supported different target, or first target
        diff_targets = [t for t in targets if t != src]
        recommended = diff_targets[0] if diff_targets else targets[0]

    reasons = {
        ("txt", "pdf"): "Converts plain text into a fixed-layout, paginated PDF suitable for universal reading and printing.",
        ("txt", "docx"): "Converts plain text into a styled Microsoft Word document ready for further editing.",
        ("txt", "html"): "Generates clean, styled HTML markup suitable for web browsers.",
        ("txt", "md"): "Formats plain text as Markdown for code documentation and lightweight markup.",
        ("md", "pdf"): "Renders Markdown headings, lists, and code blocks into a formatted, professional PDF document.",
        ("md", "html"): "Transpiles Markdown syntax into semantic HTML5 elements.",
        ("md", "docx"): "Transforms structured Markdown into a styled Word document.",
        ("docx", "pdf"): "Renders Word paragraphs and tables into an immutable PDF representation.",
        ("docx", "md"): "Extracts structured text from Word into portable, git-friendly Markdown.",
        ("docx", "txt"): "Extracts clean plain text, removing complex formatting for indexing or quick reading.",
        ("docx", "html"): "Converts document paragraphs and styles into web-friendly HTML.",
        ("pdf", "txt"): "Extracts readable text layers from the PDF document for editing or search indexing.",
        ("pdf", "md"): "Extracts text content formatted into structured Markdown blocks.",
        ("html", "pdf"): "Converts HTML markup into a print-ready PDF document.",
        ("png", "webp"): "Recompresses PNG into modern WebP with smaller file size and transparency retention.",
        ("png", "pdf"): "Packages the image into a standardized PDF page.",
        ("jpg", "webp"): "Significantly reduces image size while maintaining visual fidelity for web delivery.",
        ("jpg", "pdf"): "Encapsulates the photograph or scan into a shareable single-page PDF document.",
        ("webp", "png"): "Converts modern WebP back into universal PNG format for maximum legacy compatibility.",
    }

    reason = reasons.get((src, recommended))
    if not reason:
        reason = f"Converts {src.upper()} to {recommended.upper()} optimized for {selected_goal.replace('_', ' ')}."

    alternatives = []
    for t in targets:
        if t != recommended:
            alt_reason = reasons.get((src, t), f"Converts to {t.upper()}.")
            alternatives.append({"format": t, "reason": alt_reason})

    return {
        "source_format": src,
        "recommended_format": recommended,
        "selected_goal": selected_goal,
        "goal_description": GOAL_DESCRIPTIONS.get(selected_goal, ""),
        "reason": reason,
        "confidence": "high",
        "supported_targets": targets,
        "alternative_options": alternatives,
    }
