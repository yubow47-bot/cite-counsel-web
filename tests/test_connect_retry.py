"""request_with_retry's connect-phase retry: a cold container's first outbound
call (DNS/TCP failure) must be retried even for POSTs that set retries=0 for
idempotency — nothing was sent, so no LLM call can be duplicated.
"""
from unittest.mock import Mock

import requests

from local_tools.utils import request_with_retry


class NewConnectionError(Exception):
    """Mimics urllib3.exceptions.NewConnectionError (matched by class name)."""


def _connect_failure() -> requests.exceptions.ConnectionError:
    exc = requests.exceptions.ConnectionError("cold container")
    exc.__context__ = NewConnectionError("connection refused")
    return exc


def _session(*outcomes) -> Mock:
    session = Mock()
    session.request.side_effect = list(outcomes)
    return session


_SENTINEL = object()


def test_connect_failure_retried_even_with_retries_zero():
    session = _session(_connect_failure(), _SENTINEL)
    assert request_with_retry(session, "POST", "https://x", retries=0) is _SENTINEL
    assert session.request.call_count == 2


def test_connect_timeout_retried_even_with_retries_zero():
    timeout = requests.exceptions.ConnectTimeout("cold TLS")
    session = _session(timeout, _SENTINEL)
    assert request_with_retry(session, "POST", "https://x", retries=0) is _SENTINEL
    assert session.request.call_count == 2


def test_read_timeout_not_retried_with_retries_zero():
    # Read timeout means the server got the request — retrying a POST could
    # double-charge, so retries=0 must stay a single attempt.
    session = _session(requests.exceptions.ReadTimeout("slow LLM"))
    try:
        request_with_retry(session, "POST", "https://x", retries=0)
        raise AssertionError("expected ReadTimeout to propagate")
    except requests.exceptions.ReadTimeout:
        pass
    assert session.request.call_count == 1


def test_mid_read_connection_drop_not_retried_with_retries_zero():
    # A plain ConnectionError without a connect-phase cause means the exchange
    # was already underway — not safe to blindly retry a POST.
    session = _session(requests.exceptions.ConnectionError("dropped mid-read"))
    try:
        request_with_retry(session, "POST", "https://x", retries=0)
        raise AssertionError("expected ConnectionError to propagate")
    except requests.exceptions.ConnectionError:
        pass
    assert session.request.call_count == 1


def test_connect_budget_is_independent_of_retries():
    # retries=1 + two connect failures + success = 3 attempts
    # (1 initial + 1 connect-budget retry + 1 general retry), not 2.
    session = _session(_connect_failure(), _connect_failure(), _SENTINEL)
    assert request_with_retry(session, "GET", "https://x", retries=1) is _SENTINEL
    assert session.request.call_count == 3


def test_exhausted_connect_budget_raises_last_error():
    session = _session(_connect_failure(), _connect_failure())
    try:
        request_with_retry(session, "GET", "https://x", retries=0)
        raise AssertionError("expected ConnectionError to propagate")
    except requests.exceptions.ConnectionError:
        pass
    assert session.request.call_count == 2
