/**
 * Подписи геолокации по-русски (без зависимостей — их показывает и браузер): флаг, страна, город.
 * Страна — через Intl.DisplayNames, город — словарём крупных городов России и СНГ; остальные — как в базе.
 */
const CITIES: Record<string, string> = {
  Moscow: "Москва",
  "St Petersburg": "Санкт-Петербург",
  "Saint Petersburg": "Санкт-Петербург",
  Novosibirsk: "Новосибирск",
  Yekaterinburg: "Екатеринбург",
  Kazan: "Казань",
  "Nizhniy Novgorod": "Нижний Новгород",
  "Nizhny Novgorod": "Нижний Новгород",
  Chelyabinsk: "Челябинск",
  Samara: "Самара",
  Omsk: "Омск",
  "Rostov-on-Don": "Ростов-на-Дону",
  Ufa: "Уфа",
  Krasnoyarsk: "Красноярск",
  Voronezh: "Воронеж",
  Perm: "Пермь",
  Volgograd: "Волгоград",
  Krasnodar: "Краснодар",
  Saratov: "Саратов",
  Tyumen: "Тюмень",
  Tolyatti: "Тольятти",
  Togliatti: "Тольятти",
  Izhevsk: "Ижевск",
  Barnaul: "Барнаул",
  Ulyanovsk: "Ульяновск",
  Irkutsk: "Иркутск",
  Khabarovsk: "Хабаровск",
  Yaroslavl: "Ярославль",
  Vladivostok: "Владивосток",
  Makhachkala: "Махачкала",
  Tomsk: "Томск",
  Orenburg: "Оренбург",
  Kemerovo: "Кемерово",
  Novokuznetsk: "Новокузнецк",
  Ryazan: "Рязань",
  Astrakhan: "Астрахань",
  Penza: "Пенза",
  Lipetsk: "Липецк",
  Kirov: "Киров",
  Cheboksary: "Чебоксары",
  Tula: "Тула",
  Kaliningrad: "Калининград",
  Kursk: "Курск",
  Sochi: "Сочи",
  Stavropol: "Ставрополь",
  "Ulan-Ude": "Улан-Удэ",
  Tver: "Тверь",
  Magnitogorsk: "Магнитогорск",
  Ivanovo: "Иваново",
  Bryansk: "Брянск",
  Belgorod: "Белгород",
  Surgut: "Сургут",
  Vladimir: "Владимир",
  Nizhnevartovsk: "Нижневартовск",
  Arkhangelsk: "Архангельск",
  Chita: "Чита",
  Kaluga: "Калуга",
  Smolensk: "Смоленск",
  Kurgan: "Курган",
  Cherepovets: "Череповец",
  Oryol: "Орёл",
  Orel: "Орёл",
  Saransk: "Саранск",
  Vologda: "Вологда",
  Yakutsk: "Якутск",
  Vladikavkaz: "Владикавказ",
  Podolsk: "Подольск",
  Murmansk: "Мурманск",
  Tambov: "Тамбов",
  Grozny: "Грозный",
  Sterlitamak: "Стерлитамак",
  Petrozavodsk: "Петрозаводск",
  Kostroma: "Кострома",
  "Naberezhnyye Chelny": "Набережные Челны",
  "Naberezhnye Chelny": "Набережные Челны",
  Novorossiysk: "Новороссийск",
  "Yoshkar-Ola": "Йошкар-Ола",
  Khimki: "Химки",
  Balashikha: "Балашиха",
  Mytishchi: "Мытищи",
  Korolyov: "Королёв",
  Lyubertsy: "Люберцы",
  "Krasnogorsk": "Красногорск",
  Simferopol: "Симферополь",
  Sevastopol: "Севастополь",
  "Yuzhno-Sakhalinsk": "Южно-Сахалинск",
  "Petropavlovsk-Kamchatsky": "Петропавловск-Камчатский",
  Norilsk: "Норильск",
  "Khanty-Mansiysk": "Ханты-Мансийск",
  Syktyvkar: "Сыктывкар",
  Pskov: "Псков",
  "Veliky Novgorod": "Великий Новгород",
  Minsk: "Минск",
  Gomel: "Гомель",
  Almaty: "Алматы",
  Astana: "Астана",
  Shymkent: "Шымкент",
  Karaganda: "Караганда",
  Kyiv: "Киев",
  Kiev: "Киев",
  Kharkiv: "Харьков",
  Odesa: "Одесса",
  Tashkent: "Ташкент",
  Bishkek: "Бишкек",
  Baku: "Баку",
  Yerevan: "Ереван",
  Tbilisi: "Тбилиси",
  Chisinau: "Кишинёв",
  Dushanbe: "Душанбе",
  Riga: "Рига",
  Vilnius: "Вильнюс",
  Tallinn: "Таллин",
  Berlin: "Берлин",
  Istanbul: "Стамбул",
  Dubai: "Дубай",
  Amsterdam: "Амстердам",
  Prague: "Прага",
  Warsaw: "Варшава",
  London: "Лондон",
  Paris: "Париж",
  Belgrade: "Белград",
  Limassol: "Лимасол",
  Antalya: "Анталья",
};

let regions: Intl.DisplayNames | null = null;

/** «Россия» по коду RU; не знаем — сам код. */
export function countryName(code: string): string {
  try {
    regions ??= new Intl.DisplayNames(["ru"], { type: "region" });
    return regions.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export const cityName = (city: string) => CITIES[city] ?? city;

/** 🇷🇺 по коду страны. */
export function flag(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0)));
}

/** «Москва» (в России — без страны), «Казахстан, Алматы», «Россия»; null — не знаем. */
export function geoLabel(country: string | null, city: string | null): string | null {
  if (!country) return null;
  if (country === "RU" && city) return cityName(city);
  return city ? `${countryName(country)}, ${cityName(city)}` : countryName(country);
}
