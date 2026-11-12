import hashlib
import io
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import build_test_dataset as dataset

EXPORT = """==schema==
0004
==users==
1
7
==photos==
7,11111111-1111-1111-1111-111111111111,2026-11-01 10:00:00+00,1
7,22222222-2222-2222-2222-222222222222,2026-11-02 10:00:00+00,1
7,33333333-3333-3333-3333-333333333333,2026-11-03 10:00:00+00,2
==end==
"""


def build(export=EXPORT):
    schema, users, photos = dataset.parse_export(io.StringIO(export))
    out = io.StringIO()
    dataset.build_sql(users, photos, "$argon2id$hash", out)
    return schema, out.getvalue()


def photo_rows(sql):
    block = sql.split("COPY photos")[1].split("\\.\n")[0]
    return [line.split("\t") for line in block.splitlines()[1:]]


def test_parses_schema_users_and_photos():
    schema, users, photos = dataset.parse_export(io.StringIO(EXPORT))
    assert schema == "0004"
    assert users == [1, 7]
    assert [photo["group"] for photo in photos] == [1, 1, 2]


def test_incomplete_export_is_rejected():
    with pytest.raises(ValueError):
        dataset.parse_export(io.StringIO(EXPORT.replace("==end==\n", "")))


def test_usernames_are_anonymized_and_share_the_test_password():
    _, sql = build()
    users = sql.split("COPY users")[1].split("\\.\n")[0].splitlines()[1:]
    assert users == ["1\tuser_1\t$argon2id$hash", "7\tuser_7\t$argon2id$hash"]


def test_duplicates_keep_the_same_content_and_others_differ():
    _, sql = build()
    rows = photo_rows(sql)
    sha = [row[5] for row in rows]
    assert sha[0] == sha[1] != sha[2]
    assert [row[2] for row in rows] == ["photo-1.png", "photo-2.png", "photo-3.png"]


def test_placeholders_are_valid_pngs_matching_their_metadata():
    _, sql = build()
    for row in photo_rows(sql):
        content = bytes.fromhex(row[6].removeprefix("\\\\x"))
        assert content.startswith(b"\x89PNG\r\n\x1a\n")
        assert row[3] == "image/png"
        assert int(row[4]) == len(content)
        assert row[5] == hashlib.sha256(content).hexdigest()


def test_import_replaces_everything_in_one_transaction():
    _, sql = build()
    assert sql.startswith("BEGIN;\nTRUNCATE sessions, photos, users;\n")
    assert "setval('users_id_seq'" in sql
    assert sql.endswith("COMMIT;\n")
