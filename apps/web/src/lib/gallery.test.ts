import { createTestDb } from "@/db";
import type { Db } from "@/db";
import { addCertificates, listCertificates, setCertificateTitle } from "./certificates";
import { createExpert, expertPhotoUrls, getExpertPhoto, saveExpertPhoto } from "./experts";
import {
  MAX_GALLERY_PHOTOS,
  addGalleryPhotos,
  deleteGalleryPhoto,
  deleteMainPhoto,
  expertGallery,
  getGalleryPhoto,
  listGallery,
  makeMainPhoto,
} from "./gallery";

let db: Db;
let maria: number;
let olga: number;

/** PNG-заглушка; n — чтобы картинки отличались. */
const png = (n: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, n)]);

beforeEach(async () => {
  db = await createTestDb();
  const a = await createExpert(db, { name: "Мария", login: "maria", password: "пароль-эксперта" });
  const b = await createExpert(db, { name: "Ольга", login: "olga", password: "пароль-эксперта" });
  if (!a.ok || !b.ok) throw new Error("эксперт не создан");
  maria = a.id;
  olga = b.id;
});

describe("фото эксперта", () => {
  it("несколько за раз; плохой файл — не добавляется ни одно; не больше MAX_GALLERY_PHOTOS", async () => {
    expect(await addGalleryPhotos(db, maria, [png(1), Buffer.from("не картинка")])).toMatch("файл 2");
    expect(await listGallery(db, maria)).toEqual([]);

    expect(await addGalleryPhotos(db, maria, [png(1), png(2), png(3)])).toBeNull();
    const list = await listGallery(db, maria);
    expect(list).toHaveLength(3);
    expect(list[0]?.url).toBe(`/experts/${maria}/gallery/${list[0]?.id}`);
    expect(await getGalleryPhoto(db, olga, list[0]!.id)).toBeNull();

    const many = Array.from({ length: MAX_GALLERY_PHOTOS - 2 }, (_, i) => png(10 + i));
    expect(await addGalleryPhotos(db, maria, many)).toMatch("не больше");
    expect(await listGallery(db, maria)).toHaveLength(3);
  });

  it("листаются: главное, затем дополнительные по порядку", async () => {
    await saveExpertPhoto(db, maria, png(0));
    await addGalleryPhotos(db, maria, [png(1), png(2)]);
    const main = (await expertPhotoUrls(db)).get(maria)!;
    const urls = await expertGallery(db, maria, main);
    expect(urls[0]).toBe(main);
    expect(urls.slice(1)).toEqual((await listGallery(db, maria)).map((p) => p.url));
    expect(await expertGallery(db, olga, null)).toEqual([]);
  });

  it("«сделать главным» меняет местами с прежним главным", async () => {
    await saveExpertPhoto(db, maria, png(0));
    await addGalleryPhotos(db, maria, [png(1), png(2)]);
    const [first, second] = await listGallery(db, maria);
    await makeMainPhoto(db, maria, second!.id);

    expect((await getExpertPhoto(db, maria))?.data.equals(png(2))).toBe(true);
    const after = await listGallery(db, maria);
    expect(after).toHaveLength(2);
    expect(after[0]?.id).toBe(first!.id);
    expect((await getGalleryPhoto(db, maria, after[1]!.id))?.data.equals(png(0))).toBe(true);
    // Чужое фото главным не сделать
    await makeMainPhoto(db, olga, first!.id);
    expect(await getExpertPhoto(db, olga)).toBeNull();
  });

  it("удалить главное — его место занимает первое дополнительное", async () => {
    await saveExpertPhoto(db, maria, png(0));
    await addGalleryPhotos(db, maria, [png(1), png(2)]);
    await deleteMainPhoto(db, maria);
    expect((await getExpertPhoto(db, maria))?.data.equals(png(1))).toBe(true);
    expect(await listGallery(db, maria)).toHaveLength(1);

    const [last] = await listGallery(db, maria);
    await deleteGalleryPhoto(db, olga, last!.id);
    expect(await listGallery(db, maria)).toHaveLength(1);
    await deleteGalleryPhoto(db, maria, last!.id);
    await deleteMainPhoto(db, maria);
    expect(await getExpertPhoto(db, maria)).toBeNull();
    // Без главного удалять нечего, дополнительные не трогаются
    await addGalleryPhotos(db, maria, [png(5)]);
    await deleteMainPhoto(db, maria);
    expect(await listGallery(db, maria)).toHaveLength(1);
  });
});

describe("сертификаты пачкой", () => {
  it("несколько файлов с одной подписью, потом подпись правится у каждого", async () => {
    expect(await addCertificates(db, maria, "Диплом", [png(1), png(2)])).toBeNull();
    expect(await addCertificates(db, maria, "", [png(3), Buffer.alloc(0)])).toMatch("файл 2");
    const certs = await listCertificates(db, maria);
    expect(certs.map((c) => c.title)).toEqual(["Диплом", "Диплом"]);

    expect(await setCertificateTitle(db, maria, certs[1]!.id, " Сертификат таролога ")).toBeNull();
    expect(await setCertificateTitle(db, olga, certs[0]!.id, "чужой")).toBeNull();
    expect((await listCertificates(db, maria)).map((c) => c.title)).toEqual(["Диплом", "Сертификат таролога"]);
    expect(await setCertificateTitle(db, maria, certs[0]!.id, "я".repeat(121))).toMatch("длиннее");
  });
});
