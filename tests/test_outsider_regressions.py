"""Regressions found by using the tool as an outside user would."""
from unittest.mock import patch

from fastapi.testclient import TestClient

from api.main import app
from core.mcgill_engine import _strip_versus_period

client = TestClient(app)


def test_case_name_drops_period_after_v():
    assert _strip_versus_period("*Housen v. Nikolaisen*, 2002 SCC 33.") == "*Housen v Nikolaisen*, 2002 SCC 33."
    assert _strip_versus_period("*R. v. Jordan*, 2016 SCC 27.") == "*R v Jordan*, 2016 SCC 27."
    assert _strip_versus_period("*R. c. Smith*, 2016 CSC 27.") == "*R c Smith*, 2016 CSC 27."


def test_case_name_period_fix_only_touches_style_of_cause():
    s = "*Smith v Jones*, 2020 ONCA 1, citing RSC 1985, c. C-46"
    assert _strip_versus_period(s) == s


def test_bare_doi_in_main_search_uses_crossref_not_classifier():
    with patch("api.main.classify_and_normalize") as m_cls, \
         patch("api.main.format_citation", return_value="X") as m_fmt:
        body = client.post("/api/citation", json={"input": "10.1093/ojls/gqi001"}).json()
    m_cls.assert_not_called()
    assert m_fmt.call_args.kwargs["doc_type"] == "journal_article"
    assert body["status"] == "done"
    assert body["data"]["citations"][0]["source_type"] == "journal_article"


def test_doi_org_link_in_main_search_uses_crossref():
    with patch("api.main.classify_and_normalize") as m_cls, \
         patch("api.main.format_citation", return_value="X"):
        client.post("/api/citation", json={"input": "https://doi.org/10.1093/ojls/gqi001"})
    m_cls.assert_not_called()
