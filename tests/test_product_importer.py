import io

from openpyxl import Workbook

from app.services.product_importer import (
    google_sheet_csv_url,
    normalize_rows,
    parse_csv_bytes,
    parse_xlsx_bytes,
    suggest_mapping,
)


def test_csv_uses_first_row_as_headers_and_preserves_custom_columns():
    headers, rows = parse_csv_bytes(
        "Nume;Descriere;Poza 1;Poza 2;Marime;Culoare\nTricou;Bumbac;a.jpg;b.jpg;XL;Verde\n".encode()
    )
    assert headers == ["Nume", "Descriere", "Poza 1", "Poza 2", "Marime", "Culoare"]
    products, errors = normalize_rows(rows, {
        "title": "Nume",
        "description": "Descriere",
        "images": ["Poza 1", "Poza 2"],
    })
    assert errors == []
    assert products[0]["image_links"] == ["a.jpg", "b.jpg"]
    assert products[0]["extra_fields"]["Marime"] == "XL"
    assert products[0]["extra_fields"]["Culoare"] == "Verde"


def test_duplicate_and_empty_headers_receive_stable_names():
    headers, rows = parse_csv_bytes(b"name,,name\nA,x,y\n")
    assert headers == ["name", "column_2", "name_2"]
    assert rows[0]["name_2"] == "y"


def test_xlsx_first_row_is_header():
    workbook = Workbook()
    sheet = workbook.active
    sheet.append(["Product", "Any field"])
    sheet.append(["Camera", 42])
    stream = io.BytesIO()
    workbook.save(stream)
    headers, rows = parse_xlsx_bytes(stream.getvalue())
    assert headers == ["Product", "Any field"]
    assert rows == [{"Product": "Camera", "Any field": 42}]


def test_google_sheet_url_becomes_csv_export_and_keeps_gid():
    result = google_sheet_csv_url(
        "https://docs.google.com/spreadsheets/d/abc123/edit#gid=456"
    )
    assert result == "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=456"


def test_mapping_suggestion_is_not_required_for_arbitrary_headers():
    assert suggest_mapping(["Produs", "Camp inventat"])["title"] == "Produs"
    products, _ = normalize_rows(
        [{"Produs": "Ceas", "Camp inventat": "valoare"}], {"title": "Produs"}
    )
    assert products[0]["extra_fields"] == {"Produs": "Ceas", "Camp inventat": "valoare"}
