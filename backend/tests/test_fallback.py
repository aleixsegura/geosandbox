from backend import renderers
from backend.kernel_side.diff import Snapshot, user_variables


def test_unknown_object_renders_as_repr(rt):
    out = rt({"a": 1, "b": [1, 2, 3]}, "cfg")
    assert out["kind"] == "repr"
    assert out["name"] == "cfg"
    assert out["meta"]["type"] == "dict"
    assert "'a': 1" in out["meta"]["repr"]


def test_repr_is_truncated(rt):
    out = rt("x" * 10_000, "s")
    assert len(out["meta"]["repr"]) <= 200


def test_registry_walks_mro_and_declines():
    class Base: ...
    class Child(Base): ...

    name = renderers.qualname(Base)
    renderers.register(name)(lambda obj, n: None if getattr(obj, "skip", False) else renderers.payload("base", n))
    try:
        assert renderers.render(Child(), "c")["kind"] == "base"
        skipped = Child()
        skipped.skip = True
        assert renderers.render(skipped, "c")["kind"] == "repr"
    finally:
        renderers.REGISTRY.pop(name)


def test_long_lists_change_beyond_the_first_items():
    items = [f"cell{i}" for i in range(40)]
    before = renderers.fingerprint(items)
    items[30] = "other"
    assert renderers.fingerprint(items) != before


def test_snapshot_detects_new_changed_and_removed():
    snap = Snapshot()
    items = [1, 2]
    changed, removed = snap.update({"a": 1, "items": items})
    assert set(changed) == {"a", "items"} and removed == []
    changed, removed = snap.update({"a": 1, "items": items})
    assert changed == {} and removed == []
    items.append(3)  # same identity, new content
    changed, removed = snap.update({"items": items})
    assert set(changed) == {"items"} and removed == ["a"]


def test_user_variables_skips_private_modules_functions():
    import os

    ns = {"_x": 1, "os": os, "f": lambda: 1, "In": [], "keep": 2, "K": int}
    assert user_variables(ns, {"In"}) == {"keep": 2}
