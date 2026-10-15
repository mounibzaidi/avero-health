"""The ported checks (verify.py, dci.py, register.py), on made-up strings only: no clinical content."""

from app import register, verify
from app.dci import dci_key


def test_dci_key_drops_salts_and_hydrates_and_keeps_combinations():
    assert dci_key("CHLORHYDRATE DE MOLECULETEST") == "MOLECULETEST"
    assert dci_key("MOLECULETEST MONOHYDRATE") == "MOLECULETEST"
    assert dci_key("SELTEST EXPRIME EN MOLECULETEST") == "MOLECULETEST"
    assert dci_key("ZETATEST / ALPHATEST") == "ALPHATEST / ZETATEST"  # sorted, never one component alone


def test_quote_must_be_on_its_page_and_hold_every_number():
    pages = {1: "Texte de test : la ligne de test A vaut 12 unités de test.", 2: "Autre page de test sans rien."}
    ok = verify.verify_line("Ligne de test A : 12", 1, "la ligne de test A vaut 12 unités", pages)
    assert ok.ok
    elsewhere = verify.verify_line("Ligne de test A", 2, "la ligne de test A vaut 12 unités", pages)
    assert not elsewhere.quote_found and elsewhere.detail["found_on_pages"] == [1]
    number = verify.verify_line("Ligne de test A : 13", 1, "la ligne de test A vaut 12 unités", pages)
    assert not number.numbers_match and number.detail["numbers_missing"] == ["13"]
    short = verify.verify_line("x", 1, "test", pages)
    assert short.detail["quote"] == "trop_courte"


def test_register_match_needs_the_form_of_the_route():
    reg = {"MOLECULETEST": [
        {"brand": "MARQUE A", "form": "COMPRIME", "dosage": "1MG", "status": "enregistre", "hospital": False},
        {"brand": "MARQUE B", "form": "SOL. INJ.", "dosage": "1MG/ML", "status": "enregistre", "hospital": True},
        {"brand": "MARQUE C", "form": "COMPRIME", "dosage": "2MG", "status": "retire", "hospital": False},
    ]}
    oral = register.match(reg, {"drug": "moleculetest", "route": "PO"}, None)
    assert [b["brand"] for b in oral["brands"] if b["status"] == "ok"] == ["MARQUE A"]  # the injectable does not fit, the withdrawn one is never offered
    assert register.match(reg, {"drug": "autretest", "route": "PO"}, None) is None
    assert [e["brand"] for e in register.withdrawn(reg, "moleculetest")] == ["MARQUE C"]
