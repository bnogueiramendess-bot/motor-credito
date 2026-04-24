from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.services.credit_report_readers.agrisk import read_agrisk_report


def main(args: list[str]) -> int:
    if len(args) < 2:
        print("Uso: python scripts/agrisk_homologation_from_pdfs.py <arquivo1.pdf> [arquivo2.pdf ...]")
        return 1

    try:
        from pypdf import PdfReader
    except Exception:
        print("Dependencia ausente: pypdf. Instale com 'pip install pypdf'.")
        return 1

    for raw_path in args[1:]:
        path = Path(raw_path)
        if not path.exists():
            print(f"[ERRO] Arquivo nao encontrado: {path}")
            continue

        reader = PdfReader(str(path))
        raw_text = "\n".join((page.extract_text() or "") for page in reader.pages)
        result = read_agrisk_report(raw_text).model_dump()

        print(f"\n=== {path.name} ===")
        print(f"Paginas: {len(reader.pages)} | Caracteres extraidos: {len(raw_text)}")
        print(
            json.dumps(
                {
                    "company": result["company"],
                    "credit": result["credit"],
                    "restrictions": result["restrictions"],
                    "protests": result["protests"],
                    "consultations": result["consultations"],
                    "ownership": result["ownership"],
                    "read_quality": result["read_quality"],
                },
                ensure_ascii=False,
                indent=2,
            )
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
