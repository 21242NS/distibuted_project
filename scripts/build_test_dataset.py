import argparse
import csv
import hashlib
import struct
import sys
import zlib

WIDTH = 320
HEIGHT = 240
SECTIONS = ("schema", "users", "photos")


def parse_export(lines):
    sections = {name: [] for name in SECTIONS}
    current = None
    complete = False
    for line in lines:
        line = line.rstrip("\n")
        if line.startswith("==") and line.endswith("=="):
            marker = line.strip("=")
            if marker == "end":
                complete = True
                current = None
            elif marker in sections:
                current = marker
            continue
        if current and line:
            sections[current].append(line)
    if not complete:
        raise ValueError("export incomplet : marqueur de fin absent")
    if len(sections["schema"]) != 1:
        raise ValueError("export invalide : version du schéma absente")
    users = [int(row[0]) for row in csv.reader(sections["users"])]
    photos = [
        {"user_id": int(row[0]), "id": row[1], "created_at": row[2], "group": int(row[3])}
        for row in csv.reader(sections["photos"])
    ]
    return sections["schema"][0], users, photos


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def placeholder_png(user_id, group):
    seed = hashlib.sha256(f"{user_id}:{group}".encode()).digest()
    red, green, blue = seed[0], seed[1], seed[2]
    rows = bytearray()
    for y in range(HEIGHT):
        shade = 1 - 0.5 * y / HEIGHT
        pixel = bytes((int(red * shade), int(green * shade), int(blue * shade)))
        rows += b"\x00" + pixel * WIDTH
    header = struct.pack(">IIBBBBB", WIDTH, HEIGHT, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(bytes(rows), 9))
        + chunk(b"IEND", b"")
    )


def build_sql(users, photos, password_hash, out):
    out.write("BEGIN;\n")
    out.write("TRUNCATE sessions, photos, users;\n")
    out.write("COPY users (id, username, password_hash) FROM STDIN;\n")
    for user_id in users:
        out.write(f"{user_id}\tuser_{user_id}\t{password_hash}\n")
    out.write("\\.\n")

    out.write("COPY photos (user_id, id, filename, content_type, size, sha256, content, created_at) FROM STDIN;\n")
    images = {}
    counters = {}
    for photo in photos:
        key = (photo["user_id"], photo["group"])
        if key not in images:
            images[key] = placeholder_png(*key)
        content = images[key]
        counters[photo["user_id"]] = counters.get(photo["user_id"], 0) + 1
        filename = f"photo-{counters[photo['user_id']]}.png"
        out.write(
            f"{photo['user_id']}\t{photo['id']}\t{filename}\timage/png\t{len(content)}\t"
            f"{hashlib.sha256(content).hexdigest()}\t\\\\x{content.hex()}\t{photo['created_at']}\n"
        )
    out.write("\\.\n")
    out.write("SELECT setval('users_id_seq', COALESCE((SELECT max(id) FROM users), 0) + 1, false);\n")
    out.write("COMMIT;\n")


def main():
    parser = argparse.ArgumentParser(description="Construit le jeu de données de test à partir de l'export anonymisé")
    parser.add_argument("export", help="fichier produit par la tâche db-export")
    parser.add_argument("--password-hash", help="hash Argon2 du mot de passe commun aux comptes de test")
    parser.add_argument("--schema", action="store_true", help="affiche seulement la version du schéma de l'export")
    args = parser.parse_args()

    with open(args.export, encoding="utf-8") as export:
        schema, users, photos = parse_export(export)
    if args.schema:
        print(schema)
        return
    if not args.password_hash:
        parser.error("--password-hash est obligatoire pour construire le jeu de données")
    build_sql(users, photos, args.password_hash, sys.stdout)
    print(f"{len(users)} utilisateurs, {len(photos)} photos", file=sys.stderr)


if __name__ == "__main__":
    main()
