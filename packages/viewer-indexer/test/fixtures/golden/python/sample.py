"""Sample Python module for golden fixture testing."""

import os
import sys

from pathlib import Path
from collections import OrderedDict
from . import sibling_module
from .utils import helper_func
from ..parent import base_class

__all__ = ["greet", "MyClass", "MAX_RETRIES", "cached_lookup"]


def greet(name: str) -> str:
    """Return a greeting."""
    return f"Hello, {name}!"


def _private_helper(x: int) -> int:
    """Private helper not in __all__."""
    return x + 1


async def fetch_data(url: str) -> bytes:
    """Async function not in __all__."""
    return b""


@cache
def cached_lookup(key: str) -> str:
    """A decorated function exported via __all__."""
    return key.upper()


class MyClass:
    """A sample class."""

    def __init__(self, value: int) -> None:
        self.value = value

    def get_value(self) -> int:
        return self.value

    @staticmethod
    def create(v: int) -> "MyClass":
        return MyClass(v)

    @classmethod
    def from_dict(cls, data: dict) -> "MyClass":
        return cls(data["value"])


class _InternalClass:
    """Internal class not in __all__."""
    pass


MAX_RETRIES = 3
_TIMEOUT = 30
