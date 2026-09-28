"""classify_document_type must not silently degrade to "other" on a cold-start
LLM failure — that path formats a bare title instead of a real citation.
"""
from unittest.mock import patch

import requests

from local_tools.file_extractor import classify_document_type

ARTICLE = (
    "When Prisoners Right to Die Goes Online:\n"
    "A Case-Study of Legal and Penal Sensibilities\n"
    "doi:10.1017/cls.2022.8\n"
)
NO_DOI = "Some untitled memo text without identifiers."


def test_connect_error_is_retried_once():
    with patch("llm_api.deepseek_api.ask_deepseek",
               side_effect=[requests.exceptions.ConnectTimeout("cold"), "book"]) as m:
        assert classify_document_type(NO_DOI) == "book"
    assert m.call_count == 2


def test_llm_failure_with_doi_falls_back_to_journal_article():
    with patch("llm_api.deepseek_api.ask_deepseek",
               side_effect=requests.exceptions.ConnectionError("down")):
        assert classify_document_type(ARTICLE) == "journal_article"


def test_read_timeout_not_retried():
    # Read timeout means the request reached the server — retrying could double-charge.
    with patch("llm_api.deepseek_api.ask_deepseek",
               side_effect=requests.exceptions.ReadTimeout("slow")) as m:
        assert classify_document_type(ARTICLE) == "journal_article"
    assert m.call_count == 1


def test_llm_failure_without_doi_still_other():
    with patch("llm_api.deepseek_api.ask_deepseek", side_effect=RuntimeError("boom")):
        assert classify_document_type(NO_DOI) == "other"


def test_llm_answer_wins_over_doi():
    with patch("llm_api.deepseek_api.ask_deepseek", return_value="book_chapter"):
        assert classify_document_type(ARTICLE) == "book_chapter"
