import uuid

ALICE = {"username": "alice", "password": "Password123"}
BOB = {"username": "bob", "password": "Password123"}
PNG = b"\x89PNG\r\n\x1a\nfake-image"


def signup(client, credentials=ALICE):
    client.cookies.clear()
    assert client.post("/api/signup", json=credentials).status_code == 200


def upload(client, content=PNG, filename="photo.png"):
    response = client.post("/api/photos", files={"file": (filename, content, "image/png")})
    assert response.status_code == 201
    return response.json()["photo"]["id"]


def create(client, name="Vacances"):
    return client.post("/api/albums", json={"name": name})


def test_albums_require_a_session(client):
    assert client.get("/api/albums").status_code == 401
    assert create(client).status_code == 401


def test_create_and_list_albums(client):
    signup(client)
    assert client.get("/api/albums").json() == {"albums": [], "count": 0}

    response = create(client, "  Vacances   2026 ")
    assert response.status_code == 201
    album = response.json()
    assert album["name"] == "Vacances 2026"
    assert album["photo_count"] == 0
    assert album["cover_photo_id"] is None

    create(client, "Famille")
    names = [item["name"] for item in client.get("/api/albums").json()["albums"]]
    assert names == ["Vacances 2026", "Famille"]


def test_album_names_are_validated_and_unique(client):
    signup(client)
    assert create(client, "").status_code == 422
    assert create(client, "x" * 61).status_code == 422
    assert create(client, "Vacances").status_code == 201
    assert create(client, "Vacances").status_code == 409


def test_add_and_remove_photos(client):
    signup(client)
    first = upload(client, PNG + b"1", "a.png")
    second = upload(client, PNG + b"2", "b.png")
    album_id = create(client).json()["id"]

    added = client.post(f"/api/albums/{album_id}/photos", json={"photo_ids": [first, second, first]}).json()
    assert added["changed"] == 2
    assert added["album"]["photo_count"] == 2

    again = client.post(f"/api/albums/{album_id}/photos", json={"photo_ids": [first]}).json()
    assert again["changed"] == 0

    photos = client.get(f"/api/albums/{album_id}/photos").json()
    assert {photo["id"] for photo in photos["photos"]} == {first, second}

    removed = client.request("DELETE", f"/api/albums/{album_id}/photos", json={"photo_ids": [first]}).json()
    assert removed["changed"] == 1
    assert [photo["id"] for photo in client.get(f"/api/albums/{album_id}/photos").json()["photos"]] == [second]
    assert client.get("/api/photos").json()["count"] == 2


def test_a_photo_can_be_in_several_albums(client):
    signup(client)
    photo = upload(client)
    for name in ("Été", "Favoris"):
        album_id = create(client, name).json()["id"]
        client.post(f"/api/albums/{album_id}/photos", json={"photo_ids": [photo]})
    counts = [album["photo_count"] for album in client.get("/api/albums").json()["albums"]]
    assert counts == [1, 1]


def test_cover_is_the_last_photo_added(client):
    signup(client)
    first = upload(client, PNG + b"1")
    second = upload(client, PNG + b"2")
    album_id = create(client).json()["id"]
    client.post(f"/api/albums/{album_id}/photos", json={"photo_ids": [first]})
    client.post(f"/api/albums/{album_id}/photos", json={"photo_ids": [second]})
    assert client.get("/api/albums").json()["albums"][0]["cover_photo_id"] == second


def test_rename_album(client):
    signup(client)
    album_id = create(client, "Brouillon").json()["id"]
    create(client, "Famille")
    assert client.patch(f"/api/albums/{album_id}", json={"name": "Famille"}).status_code == 409
    response = client.patch(f"/api/albums/{album_id}", json={"name": "Noël"})
    assert response.status_code == 200
    assert response.json()["name"] == "Noël"
    assert client.patch(f"/api/albums/{album_id}", json={"name": "Noël"}).status_code == 200


def test_deleting_an_album_keeps_the_photos(client):
    signup(client)
    photo = upload(client)
    album_id = create(client).json()["id"]
    client.post(f"/api/albums/{album_id}/photos", json={"photo_ids": [photo]})

    assert client.delete(f"/api/albums/{album_id}").status_code == 204
    assert client.get("/api/albums").json()["count"] == 0
    assert client.get(f"/api/albums/{album_id}/photos").status_code == 404
    assert client.get("/api/photos").json()["count"] == 1


def test_deleting_a_photo_removes_it_from_its_albums(client):
    signup(client)
    photo = upload(client)
    album_id = create(client).json()["id"]
    client.post(f"/api/albums/{album_id}/photos", json={"photo_ids": [photo]})

    assert client.delete(f"/api/photos/{photo}").status_code == 204
    assert client.get(f"/api/albums/{album_id}/photos").json()["count"] == 0
    assert client.get("/api/albums").json()["albums"][0]["photo_count"] == 0


def test_users_cannot_touch_other_albums_or_photos(client):
    signup(client, ALICE)
    alice_photo = upload(client)
    alice_album = create(client).json()["id"]

    signup(client, BOB)
    bob_album = create(client).json()["id"]
    assert client.get(f"/api/albums/{alice_album}/photos").status_code == 404
    assert client.delete(f"/api/albums/{alice_album}").status_code == 404
    assert client.patch(f"/api/albums/{alice_album}", json={"name": "Piraté"}).status_code == 404
    assert client.post(f"/api/albums/{bob_album}/photos", json={"photo_ids": [alice_photo]}).status_code == 404
    assert client.post(f"/api/albums/{alice_album}/photos", json={"photo_ids": [alice_photo]}).status_code == 404


def test_unknown_album_and_empty_selection(client):
    signup(client)
    album_id = create(client).json()["id"]
    assert client.get(f"/api/albums/{uuid.uuid4()}/photos").status_code == 404
    assert client.post(f"/api/albums/{album_id}/photos", json={"photo_ids": []}).status_code == 422
