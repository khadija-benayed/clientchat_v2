#!/usr/bin/env python3
"""
Isolated extraction worker — spawned as subprocess by main.py.
Any native crash (SIGABRT, SIGSEGV) here does NOT kill the FastAPI server.
Input  : base64-encoded file bytes on stdin
Arg[1] : MIME type string
Output : extracted UTF-8 text on stdout
Exit   : 0 = ok, 1 = error
"""
import sys
import io
import base64


def main():
    if len(sys.argv) < 2:
        sys.exit(1)

    mime_type = sys.argv[1]

    try:
        file_bytes = base64.b64decode(sys.stdin.buffer.read())
    except Exception:
        sys.exit(1)

    text = ""

    try:
        if mime_type == "application/pdf":
            import pypdf
            parts = []
            reader = pypdf.PdfReader(io.BytesIO(file_bytes))
            for page in reader.pages:
                try:
                    t = page.extract_text(extraction_mode="layout") or ""
                except Exception:
                    t = page.extract_text() or ""
                if t.strip():
                    parts.append(t.strip())
            text = "\n\n".join(parts)

            if len(text) <= 200:
                # Little text → likely scanned (contract, invoice, etc.) → Claude Vision fallback
                try:
                    import os
                    import anthropic
                    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_KEY"])
                    resp = client.messages.create(
                        model="claude-haiku-4-5-20251001",
                        max_tokens=4096,
                        messages=[{
                            "role": "user",
                            "content": [
                                {
                                    "type": "document",
                                    "source": {
                                        "type": "base64",
                                        "media_type": "application/pdf",
                                        "data": base64.b64encode(file_bytes).decode(),
                                    },
                                },
                                {
                                    "type": "text",
                                    "text": (
                                        "Extrais tout le texte de ce document de manière fidèle et complète. "
                                        "Inclus les titres, sous-titres, tableaux (format texte), listes et corps de texte. "
                                        "Ne résume pas — retranscris le contenu intégral."
                                    ),
                                },
                            ],
                        }],
                    )
                    vision_text = resp.content[0].text if resp.content else ""
                    if vision_text.strip():
                        text = vision_text
                except Exception:
                    pass  # Claude indisponible — on garde le résultat pypdf

        elif mime_type in (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/msword",
        ):
            import zipfile
            import xml.etree.ElementTree as ET
            W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            parts = []
            with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
                if "word/document.xml" in z.namelist():
                    root = ET.fromstring(z.read("word/document.xml"))
                    for para in root.iter(f"{{{W}}}p"):
                        line = "".join(t.text or "" for t in para.iter(f"{{{W}}}t")).strip()
                        if line:
                            parts.append(line)
            text = "\n".join(parts)

        elif mime_type in (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-excel",
        ):
            import openpyxl
            parts = []
            wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True, read_only=True)
            for sheet in wb.worksheets:
                parts.append(f"[Feuille : {sheet.title}]")
                for row in sheet.iter_rows(values_only=True):
                    cells = [str(c) if c is not None else "" for c in row]
                    if any(c.strip() for c in cells):
                        parts.append(" | ".join(cells))
            wb.close()
            text = "\n".join(parts)

        elif mime_type == "application/vnd.openxmlformats-officedocument.presentationml.presentation":
            import zipfile
            import xml.etree.ElementTree as ET
            A = "http://schemas.openxmlformats.org/drawingml/2006/main"
            parts = []
            with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
                slides = sorted(
                    n for n in z.namelist()
                    if n.startswith("ppt/slides/slide") and n.endswith(".xml")
                )
                for i, slide_path in enumerate(slides, 1):
                    parts.append(f"[Slide {i}]")
                    root = ET.fromstring(z.read(slide_path))
                    for para in root.iter(f"{{{A}}}p"):
                        line = "".join(t.text or "" for t in para.iter(f"{{{A}}}t")).strip()
                        if line:
                            parts.append(line)
            text = "\n".join(parts)

        elif mime_type in ("text/plain", "text/csv"):
            text = file_bytes.decode("utf-8", errors="replace")

    except Exception:
        sys.exit(1)

    sys.stdout.buffer.write(text.encode("utf-8", errors="replace"))


if __name__ == "__main__":
    main()
