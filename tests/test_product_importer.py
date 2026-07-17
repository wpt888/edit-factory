import io

from openpyxl import Workbook

import pytest

from app.services.product_importer import (
    google_sheet_csv_url,
    html_to_text,
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


def test_html_to_text_does_not_glue_adjacent_list_items():
    """The bug a naive re.sub(r'<[^>]*>', '') strip produces."""
    out = html_to_text("<ul><li>lentila dubla</li><li>lentila transparenta</li></ul>")
    assert out == "- lentila dubla\n- lentila transparenta"


def test_html_to_text_decodes_entities_and_drops_tags():
    out = html_to_text("<p>Bumbac &amp; in</p><p>Marime&nbsp;XL</p>")
    assert out == "Bumbac & in\nMarime XL"
    assert "<" not in out and "&" in out  # the '&' is the decoded entity, not markup


@pytest.mark.parametrize("value", ["Marime < 5 kg", "<XL", "A > B", "R&D", "10682.60", ""])
def test_html_to_text_leaves_non_markup_untouched(value):
    """A bare '<' must not be mistaken for a tag — HTMLParser would eat the data."""
    assert html_to_text(value) == value


def test_html_to_text_is_idempotent():
    once = html_to_text("<ul><li>a</li><li>b</li></ul>")
    assert html_to_text(once) == once


def test_import_strips_html_from_description_and_extra_fields():
    headers, rows = parse_csv_bytes(
        "Nume,Descriere,Marime\n"
        "Tricou,<ul><li>bumbac</li><li>rezistent</li></ul>,XL\n".encode()
    )
    products, errors = normalize_rows(rows, {"title": "Nume", "description": "Descriere"})
    assert errors == []
    assert products[0]["description"] == "- bumbac\n- rezistent"
    # extra_fields feeds the prompt verbatim, so its copy must be clean too.
    assert products[0]["extra_fields"]["Descriere"] == "- bumbac\n- rezistent"
    assert products[0]["extra_fields"]["Marime"] == "XL"


def test_import_keeps_non_string_cells_intact():
    """xlsx yields ints/floats — _clean must pass them through, not stringify."""
    products, _ = normalize_rows(
        [{"Product": "Camera", "Stock": 42, "Price": 19.99}], {"title": "Product"}
    )
    assert products[0]["extra_fields"]["Stock"] == 42
    assert products[0]["extra_fields"]["Price"] == 19.99
