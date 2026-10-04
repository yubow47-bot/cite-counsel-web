"""Tests for legisinfo_api deterministic builder and _wrap_italic helper."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from local_tools.legisinfo_api import _wrap_italic, build_bill_citation


class TestWrapItalic:

    def test_plain_string_wrapped(self):
        assert _wrap_italic("An Act") == "*An Act*"

    def test_already_wrapped_noop(self):
        assert _wrap_italic("*An Act*") == "*An Act*"

    def test_leading_trailing_whitespace_stripped(self):
        assert _wrap_italic("  *An Act*  ") == "*An Act*"

    def test_internal_asterisks_untouched(self):
        result = _wrap_italic("title with *inner* markup")
        assert result == "*title with *inner* markup*"

    def test_empty_string(self):
        assert _wrap_italic("") == ""

    def test_none_returns_none(self):
        assert _wrap_italic(None) is None


class TestBuildBillCitation:

    def test_italicizes_title(self):
        rec = {
            "BillNumberFormatted": "C-32",
            "LongTitleEn": "An Act to amend the Copyright Act",
            "ParliamentNumber": 35, "SessionNumber": 2,
            "ParlSessionCode": "35-2",
        }
        cit = build_bill_citation(rec)
        assert "*An Act to amend the Copyright Act*" in cit
        assert cit.startswith("Bill C-32,")
        assert cit.endswith(".")

    def test_does_not_double_wrap(self):
        rec = {
            "BillNumberFormatted": "C-32",
            "LongTitleEn": "*Already Italic*",
            "ParliamentNumber": 35, "SessionNumber": 2,
            "ParlSessionCode": "35-2",
        }
        cit = build_bill_citation(rec)
        assert "**" not in cit
        assert "*Already Italic*" in cit

    def test_short_title_fallback(self):
        rec = {
            "BillNumberFormatted": "S-2",
            "LongTitleEn": "",
            "ShortTitleEn": "Short Title",
            "ParliamentNumber": 40, "SessionNumber": 2,
            "ParlSessionCode": "40-2",
        }
        cit = build_bill_citation(rec)
        assert "*Short Title*" in cit

    def test_missing_title_uses_question_mark(self):
        rec = {
            "BillNumberFormatted": "X-1",
            "LongTitleEn": "",
            "ShortTitleEn": "",
            "ParliamentNumber": 45, "SessionNumber": 1,
        }
        cit = build_bill_citation(rec)
        assert "?" in cit
        assert cit.startswith("Bill X-1,")


class TestOpenParliamentFallback:

    def _resp(self, payload, status=200):
        from unittest.mock import MagicMock
        r = MagicMock()
        r.status_code = status
        r.json.return_value = payload
        return r

    def test_maps_records_onto_legisinfo_fields(self):
        from unittest.mock import patch
        from local_tools import legisinfo_api as li
        payload = {
            "objects": [{
                "session": "44-1", "legisinfo_id": 123, "introduced": "2022-05-30",
                "name": {"en": "An Act to amend certain Acts (firearms)"}, "number": "C-21",
            }],
            "pagination": {"next_url": None},
        }
        with patch.object(li, "request_with_retry", return_value=self._resp(payload)):
            recs = li._fetch_openparliament("44-1")
        assert recs[0]["BillNumberFormatted"] == "C-21"
        assert recs[0]["ParlSessionCode"] == "44-1"
        assert build_bill_citation(recs[0]) == (
            "Bill C-21, *An Act to amend certain Acts (firearms)*, 1st Sess, 44th Parl, 2022."
        )

    def test_used_when_legisinfo_fetch_fails(self):
        from unittest.mock import patch
        from local_tools import legisinfo_api as li
        rec = {"BillNumberFormatted": "C-21", "ParlSessionCode": "45-1"}
        with patch.object(li, "_fetch_json", return_value=None), \
             patch.object(li, "_fetch_openparliament", return_value=[rec]) as op, \
             patch.object(li, "_CACHE", {}), patch.object(li, "_CACHE_TIME", {}):
            assert li.fetch_legisinfo_bills(session="45-1") == [rec]
        op.assert_called_once_with("45-1")

    def test_http_error_returns_none(self):
        from unittest.mock import patch
        from local_tools import legisinfo_api as li
        with patch.object(li, "request_with_retry", return_value=self._resp({}, status=503)):
            assert li._fetch_openparliament("45-1") is None
