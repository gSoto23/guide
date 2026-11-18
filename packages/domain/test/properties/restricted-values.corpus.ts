import type { RestrictedValueKind } from "../../src/properties/restricted-values.js";

/**
 * Labeled corpus for the restricted-value detector (feature 002 R4, T010).
 *
 * Every snippet is synthetic and written for these tests: the codes, passwords, network names,
 * addresses, prices, and phone numbers are made up. `codes` lists each value that must be removed,
 * with its kind; `keep` lists look-alikes that must survive verbatim.
 */
export interface CorpusEntry {
  id: string;
  lang: "es" | "en";
  text: string;
  codes: ReadonlyArray<{ value: string; kind: RestrictedValueKind }>;
  keep: readonly string[];
}

const door = (value: string) => ({ value, kind: "door_code" as const });
const gate = (value: string) => ({ value, kind: "gate_code" as const });
const lockbox = (value: string) => ({ value, kind: "lockbox_code" as const });
const alarm = (value: string) => ({ value, kind: "alarm_code" as const });
const wifi = (value: string) => ({ value, kind: "wifi_password" as const });
const other = (value: string) => ({ value, kind: "other" as const });

/** Snippets that hold at least one restricted value (feature 002). */
const CODE_SNIPPETS_002: readonly CorpusEntry[] = [
  // English: keyword before the value.
  { id: "en-door-basic", lang: "en", text: "Door code 4821", codes: [door("4821")], keep: [] },
  { id: "en-code-is", lang: "en", text: "The code is 4821", codes: [other("4821")], keep: [] },
  {
    id: "en-keypad-hash",
    lang: "en",
    text: "Front door keypad: 7395#",
    codes: [door("7395#")],
    keep: [],
  },
  { id: "en-pin-zeros", lang: "en", text: "PIN 0000", codes: [other("0000")], keep: [] },
  {
    id: "en-smart-lock",
    lang: "en",
    text: "Smart lock PIN: 2468",
    codes: [door("2468")],
    keep: [],
  },
  { id: "en-gate-star", lang: "en", text: "Gate code 1234*", codes: [gate("1234*")], keep: [] },
  { id: "en-lockbox-mixed", lang: "en", text: "Lockbox: A1B2", codes: [lockbox("A1B2")], keep: [] },
  {
    id: "en-wifi-pass",
    lang: "en",
    text: "Wi-Fi: CasaColibri / pass: Colibri2026",
    codes: [wifi("Colibri2026")],
    keep: ["CasaColibri"],
  },
  {
    id: "en-alarm-seconds",
    lang: "en",
    text: "Alarm code 9087, disarm within 30 seconds.",
    codes: [alarm("9087")],
    keep: ["30 seconds"],
  },
  {
    id: "en-wifi-two-lines",
    lang: "en",
    text: "WiFi network: Colibri_Guest_5G\nPassword: TucanVerde2026",
    codes: [wifi("TucanVerde2026")],
    keep: ["Colibri_Guest_5G"],
  },
  { id: "en-next-line", lang: "en", text: "Door code:\n4821", codes: [door("4821")], keep: [] },
  { id: "en-garage", lang: "en", text: "Garage code: 5512", codes: [gate("5512")], keep: [] },
  {
    id: "en-key-box-dashes",
    lang: "en",
    text: "Key box combination: 3-7-1-9",
    codes: [lockbox("3-7-1-9")],
    keep: [],
  },
  {
    id: "en-three-codes",
    lang: "en",
    text: "Codes: front door 2580, side gate 1470, alarm 3690.",
    codes: [door("2580"), gate("1470"), alarm("3690")],
    keep: [],
  },
  {
    id: "en-uppercase",
    lang: "en",
    text: "DOOR CODE: 6655 / GATE: 7766",
    codes: [door("6655"), gate("7766")],
    keep: [],
  },
  {
    id: "en-emoji",
    lang: "en",
    text: "🔑 Lockbox code 🔐 → 8C3D ✨",
    codes: [lockbox("8C3D")],
    keep: ["🔑", "✨"],
  },
  {
    id: "en-wifi-sentence",
    lang: "en",
    text: "The Wi-Fi password is SunnyGecko77",
    codes: [wifi("SunnyGecko77")],
    keep: [],
  },
  {
    id: "en-passcode",
    lang: "en",
    text: "Passcode for the building: 3141",
    codes: [other("3141")],
    keep: [],
  },
  {
    id: "en-network-bar",
    lang: "en",
    text: "Network: Colibri-Guest | Password: Hummingbird42",
    codes: [wifi("Hummingbird42")],
    keep: ["Colibri-Guest"],
  },
  {
    id: "en-blank-line",
    lang: "en",
    text: "Alarm panel code\n\n1357",
    codes: [alarm("1357")],
    keep: [],
  },
  { id: "en-year-like", lang: "en", text: "Gate: 2024#", codes: [gate("2024#")], keep: [] },
  {
    id: "en-upper-wifi",
    lang: "en",
    text: "WIFI PASSWORD: COLIBRI2026",
    codes: [wifi("COLIBRI2026")],
    keep: [],
  },
  {
    id: "en-wifi-key",
    lang: "en",
    text: "Wifi key: Gecko-Verde-31",
    codes: [wifi("Gecko-Verde-31")],
    keep: [],
  },
  {
    id: "en-spaced-digits",
    lang: "en",
    text: "Lockbox code is 2 4 6 8",
    codes: [lockbox("2 4 6 8")],
    keep: [],
  },
  { id: "en-glued-pin", lang: "en", text: "Door PIN-7788", codes: [door("7788")], keep: [] },
  {
    id: "en-next-line-hash",
    lang: "en",
    text: "Gate code\n#2468",
    codes: [gate("#2468")],
    keep: [],
  },
  { id: "en-alarm-letters", lang: "en", text: "Alarm: A9B8C7", codes: [alarm("A9B8C7")], keep: [] },
  {
    id: "en-emoji-two",
    lang: "en",
    text: "Front door: 1357 🙂 Back gate: 8642 🌴",
    codes: [door("1357"), gate("8642")],
    keep: ["🙂", "Back gate", "🌴"],
  },
  {
    id: "en-wifi-cabin",
    lang: "en",
    text: "Wi-Fi password for the cabin is Toucan2026",
    codes: [wifi("Toucan2026")],
    keep: ["for the cabin is"],
  },
  {
    id: "en-keypad-then",
    lang: "en",
    text: "Keypad: 3030 then press ✔",
    codes: [door("3030")],
    keep: ["then press ✔"],
  },
  {
    id: "en-gate-opens",
    lang: "en",
    text: "Our gate opens with code 6060#",
    codes: [gate("6060#")],
    keep: [],
  },
  {
    id: "en-letters-password",
    lang: "en",
    text: "Password: mangotango",
    codes: [other("mangotango")],
    keep: [],
  },
  {
    id: "en-name-then-password",
    lang: "en",
    text: "Wi-Fi: CasaColibri_5G Colibri2026",
    codes: [wifi("Colibri2026")],
    keep: ["CasaColibri_5G"],
  },
  // English: value before the keyword.
  {
    id: "en-use-to-open",
    lang: "en",
    text: "Use 4821 to open the front door.",
    codes: [door("4821")],
    keep: [],
  },
  {
    id: "en-enter-keypad",
    lang: "en",
    text: "Enter 9182# on the keypad when you arrive.",
    codes: [door("9182#")],
    keep: ["when you arrive"],
  },
  {
    id: "en-value-first",
    lang: "en",
    text: "4821 is the door code",
    codes: [door("4821")],
    keep: ["is the door code"],
  },
  // English: codes mixed with look-alikes.
  {
    id: "en-mixed-times",
    lang: "en",
    text: "Check-in 15:00. Door code: 4821. Checkout 11:00.",
    codes: [door("4821")],
    keep: ["Check-in 15:00", "Checkout 11:00"],
  },
  {
    id: "en-mixed-phone",
    lang: "en",
    text: "Call +506 8888 1234 if the door code 2580 does not work.",
    codes: [door("2580")],
    keep: ["+506 8888 1234"],
  },
  {
    id: "en-mixed-rooms",
    lang: "en",
    text: "3 bedrooms, sleeps 6. Lockbox code 7G4H, located left of the door.",
    codes: [lockbox("7G4H")],
    keep: ["3 bedrooms", "sleeps 6", "located left of the door"],
  },
  {
    id: "en-mixed-price",
    lang: "en",
    text: "Price $150/night. Wi-Fi: Colibri_Lodge, password: Lodge2026",
    codes: [wifi("Lodge2026")],
    keep: ["$150/night", "Colibri_Lodge"],
  },
  {
    id: "en-mixed-block",
    lang: "en",
    text: "House info\nWi-Fi\nNetwork: Colibri_Home\nPassword: GreenParrot88\nDoor code: 4567\nCheck-in after 15:00",
    codes: [wifi("GreenParrot88"), door("4567")],
    keep: ["Colibri_Home", "Check-in after 15:00"],
  },

  // Spanish: keyword before the value.
  {
    id: "es-door-hash",
    lang: "es",
    text: "código de la puerta: 4821#",
    codes: [door("4821#")],
    keep: [],
  },
  {
    id: "es-wifi-clave",
    lang: "es",
    text: "clave del wifi Colibri2026",
    codes: [wifi("Colibri2026")],
    keep: [],
  },
  {
    id: "es-three-codes",
    lang: "es",
    text: "Puerta principal 7319, portón 2846 y alarma 6604.",
    codes: [door("7319"), gate("2846"), alarm("6604")],
    keep: ["Puerta principal"],
  },
  {
    id: "es-red-sentence",
    lang: "es",
    text: "La contraseña de la red es TucanAzul2026",
    codes: [wifi("TucanAzul2026")],
    keep: [],
  },
  {
    id: "es-caja-seguridad",
    lang: "es",
    text: "Caja de seguridad: 4B7C",
    codes: [lockbox("4B7C")],
    keep: [],
  },
  {
    id: "es-codigo-entrar",
    lang: "es",
    text: "El código para entrar es 1029",
    codes: [other("1029")],
    keep: [],
  },
  {
    id: "es-next-line-star",
    lang: "es",
    text: "Código del portón:\n5566*",
    codes: [gate("5566*")],
    keep: [],
  },
  {
    id: "es-red-clave-lines",
    lang: "es",
    text: "Red: CasaColibri_5G\nClave: Colibri2026",
    codes: [wifi("Colibri2026")],
    keep: ["CasaColibri_5G"],
  },
  {
    id: "es-pin-alarma",
    lang: "es",
    text: "PIN de la alarma 0420",
    codes: [alarm("0420")],
    keep: [],
  },
  {
    id: "es-caja-llaves",
    lang: "es",
    text: "Caja de llaves (combinación): 1793",
    codes: [lockbox("1793")],
    keep: [],
  },
  {
    id: "es-emoji-wifi",
    lang: "es",
    text: "Contraseña Wi-Fi 👉 Mango2026!",
    codes: [wifi("Mango2026!")],
    keep: ["👉"],
  },
  {
    id: "es-codigos-lista",
    lang: "es",
    text: "Códigos: puerta 3812, portón 9021.",
    codes: [door("3812"), gate("9021")],
    keep: [],
  },
  {
    id: "es-caja-fuerte",
    lang: "es",
    text: "La clave de la caja fuerte es 2580",
    codes: [lockbox("2580")],
    keep: [],
  },
  {
    id: "es-long-password",
    lang: "es",
    text: "Wifi: CasaColibri\nContraseña: colibri-verde-2026",
    codes: [wifi("colibri-verde-2026")],
    keep: ["CasaColibri"],
  },
  {
    id: "es-spaced-digits",
    lang: "es",
    text: "Alarma: 4 8 2 1",
    codes: [alarm("4 8 2 1")],
    keep: [],
  },
  {
    id: "es-porton-use",
    lang: "es",
    text: "Para abrir el portón use el código 7070.",
    codes: [gate("7070")],
    keep: [],
  },
  { id: "es-pin-es", lang: "es", text: "El PIN es 0000", codes: [other("0000")], keep: [] },
  {
    id: "es-clave-mixed",
    lang: "es",
    text: "clave: 12AB34CD",
    codes: [other("12AB34CD")],
    keep: [],
  },
  {
    id: "es-letters-password",
    lang: "es",
    text: "Contraseña del internet: bienvenidos",
    codes: [wifi("bienvenidos")],
    keep: [],
  },
  {
    id: "es-two-door-codes",
    lang: "es",
    text: "Puerta: 4821 o 4822 (código alterno)",
    codes: [door("4821"), door("4822")],
    keep: ["(código alterno)"],
  },
  {
    id: "es-codigo-acceso",
    lang: "es",
    text: "Código de acceso 248613",
    codes: [other("248613")],
    keep: [],
  },
  {
    id: "es-upper-wifi",
    lang: "es",
    text: "PASSWORD DEL WIFI: LORO2026",
    codes: [wifi("LORO2026")],
    keep: [],
  },
  {
    id: "es-clave-alarma",
    lang: "es",
    text: "Clave alarma 9911",
    codes: [alarm("9911")],
    keep: [],
  },
  {
    id: "es-cerradura",
    lang: "es",
    text: "La cerradura inteligente usa el código 8080",
    codes: [door("8080")],
    keep: [],
  },
  {
    id: "es-cajita-llaves",
    lang: "es",
    text: "Llegada: tome la llave de la cajita de llaves, clave 4466.",
    codes: [lockbox("4466")],
    keep: [],
  },
  // Spanish: value before the keyword.
  {
    id: "es-marque-teclado",
    lang: "es",
    text: "Marque 4455 en el teclado de la puerta.",
    codes: [door("4455")],
    keep: [],
  },
  {
    id: "es-value-first",
    lang: "es",
    text: "Colibri2026 es la contraseña del wifi",
    codes: [wifi("Colibri2026")],
    keep: [],
  },
  // Spanish: codes mixed with look-alikes.
  {
    id: "es-mixed-price",
    lang: "es",
    text: "Casa para 6 personas, $95 por noche. Código del portón: 3377.",
    codes: [gate("3377")],
    keep: ["6 personas", "$95 por noche"],
  },
  {
    id: "es-mixed-speed",
    lang: "es",
    text: "Wifi: Colibri_5G (300 Mbps) · Clave: Verde2026",
    codes: [wifi("Verde2026")],
    keep: ["Colibri_5G", "300 Mbps"],
  },
  {
    id: "es-mixed-address",
    lang: "es",
    text: "Dirección ficticia: Avenida Ejemplo 1234, Apartamento 5B. Puerta: 9753",
    codes: [door("9753")],
    keep: ["Avenida Ejemplo 1234", "Apartamento 5B"],
  },
  {
    id: "es-mixed-checkin",
    lang: "es",
    text: "🚪 Código de entrada: 5821 🔐\nCheck-in desde las 15:00",
    codes: [other("5821")],
    keep: ["Check-in desde las 15:00"],
  },
];

/** Snippets with look-alikes only: nothing may be removed. */

/**
 * Feature 003 (research R5): phrasings from interview answers, voice transcripts, and guide text,
 * including spelled-out digits and digit groups split by spaces or dashes.
 */
const GUIDE_CODE_SNIPPETS: readonly CorpusEntry[] = [
  {
    id: "es-spelled-door",
    lang: "es",
    text: "El código de la puerta es cuatro ocho dos uno.",
    codes: [door("cuatro ocho dos uno")],
    keep: [],
  },
  {
    id: "es-split-lockbox",
    lang: "es",
    text: "La caja de llaves se abre con 48 21",
    codes: [lockbox("48 21")],
    keep: [],
  },
  {
    id: "es-dashed-keypad",
    lang: "es",
    text: "Marque 4-8-2-1 en el teclado",
    codes: [door("4-8-2-1")],
    keep: [],
  },
  {
    id: "es-opens-with",
    lang: "es",
    text: "Para entrar, la puerta se abre con 2580.",
    codes: [door("2580")],
    keep: [],
  },
  {
    id: "es-spelled-gate",
    lang: "es",
    text: "El portón abre con el código cero nueve cero nueve",
    codes: [gate("cero nueve cero nueve")],
    keep: [],
  },
  {
    id: "es-transcript-lockbox",
    lang: "es",
    text: "sí, este, el código de la caja es el uno dos tres cuatro y ya",
    codes: [lockbox("uno dos tres cuatro")],
    keep: [],
  },
  {
    id: "es-padlock",
    lang: "es",
    text: "La combinación del candado es 3-3-0-7",
    codes: [lockbox("3-3-0-7")],
    keep: [],
  },
  {
    id: "es-alarm-spaced",
    lang: "es",
    text: "La alarma se desactiva con el 7 3 9 5 antes de 30 segundos.",
    codes: [alarm("7 3 9 5")],
    keep: ["30 segundos"],
  },
  {
    id: "es-transcript-wifi",
    lang: "es",
    text: "la clave del wifi es mango dos mil veintiséis, todo junto",
    codes: [wifi("mango")],
    keep: [],
  },
  {
    id: "es-opens-spelled",
    lang: "es",
    text: "La puerta de atrás se abre con nueve cinco uno uno.",
    codes: [door("nueve cinco uno uno")],
    keep: [],
  },
  {
    id: "en-spelled-door",
    lang: "en",
    text: "The door code is four eight two one.",
    codes: [door("four eight two one")],
    keep: [],
  },
  {
    id: "en-split-lockbox",
    lang: "en",
    text: "The lockbox opens with 48 21.",
    codes: [lockbox("48 21")],
    keep: [],
  },
  {
    id: "en-dashed-keypad",
    lang: "en",
    text: "Punch in 4-8-2-1 on the keypad",
    codes: [door("4-8-2-1")],
    keep: [],
  },
  {
    id: "en-opens-with",
    lang: "en",
    text: "To get in, the door opens with 2580",
    codes: [door("2580")],
    keep: [],
  },
  {
    id: "en-spelled-alarm",
    lang: "en",
    text: "Alarm: nine three seven five, then press off",
    codes: [alarm("nine three seven five")],
    keep: [],
  },
  {
    id: "en-spelled-oh",
    lang: "en",
    text: "The gate code is oh nine oh nine",
    codes: [gate("oh nine oh nine")],
    keep: [],
  },
  {
    id: "en-transcript-lockbox",
    lang: "en",
    text: "um so the code for the lockbox is one two three four, yeah",
    codes: [lockbox("one two three four")],
    keep: [],
  },
  {
    id: "en-padlock",
    lang: "en",
    text: "The padlock combination is 3-3-0-7",
    codes: [lockbox("3-3-0-7")],
    keep: [],
  },
  {
    id: "en-garage-spaced",
    lang: "en",
    text: "The garage opens with code 1 9 8 4",
    codes: [gate("1 9 8 4")],
    keep: [],
  },
  {
    id: "en-opens-spelled",
    lang: "en",
    text: "The back door opens with five five two zero.",
    codes: [door("five five two zero")],
    keep: [],
  },
];

/** Snippets that hold at least one restricted value. */
export const CODE_SNIPPETS: readonly CorpusEntry[] = [...CODE_SNIPPETS_002, ...GUIDE_CODE_SNIPPETS];

const LOOK_ALIKE_SNIPPETS_002: readonly CorpusEntry[] = [
  // Prices.
  {
    id: "es-price",
    lang: "es",
    text: "Tarifa: $120 por noche, limpieza USD 85.",
    codes: [],
    keep: ["$120 por noche", "USD 85"],
  },
  {
    id: "es-price-colones",
    lang: "es",
    text: "Precio por noche ₡45000, mínimo 2 noches.",
    codes: [],
    keep: ["₡45000"],
  },
  {
    id: "es-discount",
    lang: "es",
    text: "Mínimo 2 noches; descuento del 15% por semana.",
    codes: [],
    keep: ["15%"],
  },
  // Phone numbers.
  {
    id: "en-phone-cr",
    lang: "en",
    text: "Call or WhatsApp +506 8888 1234 for help.",
    codes: [],
    keep: ["+506 8888 1234"],
  },
  {
    id: "en-phone-us",
    lang: "en",
    text: "Our office line is (555) 010-2030.",
    codes: [],
    keep: ["(555) 010-2030"],
  },
  {
    id: "es-phone",
    lang: "es",
    text: "Llámenos al 555-0199 si tiene dudas.",
    codes: [],
    keep: ["555-0199"],
  },
  // Addresses, postal codes, and area codes.
  {
    id: "es-address-postal",
    lang: "es",
    text: "Dirección: Calle Ficticia 5, Avenida 10, casa 2345, código postal 10101.",
    codes: [],
    keep: ["casa 2345", "código postal 10101"],
  },
  {
    id: "en-address-zip",
    lang: "en",
    text: "ZIP code 12345, fictional address at 742 Example Lane.",
    codes: [],
    keep: ["ZIP code 12345", "742 Example Lane"],
  },
  {
    id: "en-area-code",
    lang: "en",
    text: "Area code 506; local numbers have 8 digits.",
    codes: [],
    keep: ["Area code 506"],
  },
  {
    id: "en-room-numbers",
    lang: "en",
    text: "Room 12, floor 3, apartment 4B.",
    codes: [],
    keep: ["Room 12"],
  },
  {
    id: "en-map-pin",
    lang: "en",
    text: "Coordinates for the map pin: 12.3456, -65.4321",
    codes: [],
    keep: ["12.3456", "-65.4321"],
  },
  // Check-in and checkout times.
  {
    id: "en-times",
    lang: "en",
    text: "Check-in 15:00, checkout 11:00.",
    codes: [],
    keep: ["15:00", "11:00"],
  },
  {
    id: "es-times",
    lang: "es",
    text: "Hora de entrada: 3 pm. Salida: 11:00 am.",
    codes: [],
    keep: ["3 pm", "11:00 am"],
  },
  {
    id: "en-late-checkout",
    lang: "en",
    text: "Late checkout until 1300 on request.",
    codes: [],
    keep: ["1300"],
  },
  {
    id: "en-pool-hours",
    lang: "en",
    text: "The pool is open 0800–2000 daily.",
    codes: [],
    keep: ["0800–2000"],
  },
  {
    id: "en-keypad-quiet-hours",
    lang: "en",
    text: "Self check-in with a keypad. Quiet hours 22:00 to 07:00.",
    codes: [],
    keep: ["22:00 to 07:00"],
  },
  {
    id: "en-alarm-clock",
    lang: "en",
    text: "Alarm clock and hair dryer provided; checkout by 10:30.",
    codes: [],
    keep: ["10:30"],
  },
  // Room and guest counts.
  {
    id: "es-rooms",
    lang: "es",
    text: "3 habitaciones, 2 baños, capacidad para 6 huéspedes.",
    codes: [],
    keep: ["3 habitaciones", "6 huéspedes"],
  },
  {
    id: "en-sleeps",
    lang: "en",
    text: "Sleeps 6 · 2 bedrooms · 1,200 sq ft",
    codes: [],
    keep: ["Sleeps 6", "1,200 sq ft"],
  },
  {
    id: "en-guest-limit",
    lang: "en",
    text: "Guest limit: 4 adults and 2 kids.",
    codes: [],
    keep: ["4 adults and 2 kids"],
  },
  {
    id: "es-parking",
    lang: "es",
    text: "Parqueo para 2 carros, portón eléctrico.",
    codes: [],
    keep: ["portón eléctrico"],
  },
  // Years.
  {
    id: "en-years",
    lang: "en",
    text: "Built in 2019, renovated in 2024.",
    codes: [],
    keep: ["2019", "2024"],
  },
  // Wi-Fi network names and speeds.
  {
    id: "es-red-name",
    lang: "es",
    text: "Red: CasaColibri_5G",
    codes: [],
    keep: ["CasaColibri_5G"],
  },
  {
    id: "en-network-name",
    lang: "en",
    text: "Network name: Colibri-Guest",
    codes: [],
    keep: ["Colibri-Guest"],
  },
  {
    id: "en-open-network",
    lang: "en",
    text: "Wi-Fi network: CasaColibri_2G (no password needed)",
    codes: [],
    keep: ["CasaColibri_2G", "no password needed"],
  },
  {
    id: "es-wifi-speed",
    lang: "es",
    text: "Wi-Fi de 300 Mbps en toda la casa.",
    codes: [],
    keep: ["300 Mbps"],
  },
  {
    id: "es-internet-speed",
    lang: "es",
    text: "Internet de fibra óptica 200Mbps",
    codes: [],
    keep: ["200Mbps"],
  },
  {
    id: "en-wifi-garage",
    lang: "en",
    text: "Free Wi-Fi, smart TV, and a 2-car garage.",
    codes: [],
    keep: ["2-car garage"],
  },
  // Other look-alikes near keywords.
  {
    id: "en-booking-code",
    lang: "en",
    text: "Booking confirmation code HMX4Q2, keep it for your records.",
    codes: [],
    keep: ["HMX4Q2"],
  },
  {
    id: "en-airport-gate",
    lang: "en",
    text: "Gate 3 at the airport is 25 minutes away.",
    codes: [],
    keep: ["Gate 3", "25 minutes"],
  },
  {
    id: "es-social",
    lang: "es",
    text: "Síguenos en redes sociales: @CasaColibri2026",
    codes: [],
    keep: ["@CasaColibri2026"],
  },
  {
    id: "en-door-to-door",
    lang: "en",
    text: "Door-to-door shuttle for 4 guests, $25 per person.",
    codes: [],
    keep: ["$25 per person"],
  },
];

/** Feature 003 look-alikes: spelled numbers and short numbers that are not codes. */
const GUIDE_LOOK_ALIKE_SNIPPETS: readonly CorpusEntry[] = [
  {
    id: "es-rooms-spelled",
    lang: "es",
    text: "La casa tiene cuatro habitaciones y dos baños.",
    codes: [],
    keep: ["cuatro habitaciones", "dos baños"],
  },
  {
    id: "es-checkin-spelled",
    lang: "es",
    text: "El check-in es a las tres de la tarde y la salida a las once.",
    codes: [],
    keep: ["tres de la tarde", "las once"],
  },
  {
    id: "es-phone-before-door",
    lang: "es",
    text: "Llama al 8888-0000 si tienes problemas con la puerta.",
    codes: [],
    keep: ["8888-0000"],
  },
  {
    id: "en-parking-spelled",
    lang: "en",
    text: "Checkout is at eleven, and there are two parking spots by the gate.",
    codes: [],
    keep: ["eleven", "two parking spots"],
  },
  {
    id: "en-door-number",
    lang: "en",
    text: "The door is the second one on the left, number 12.",
    codes: [],
    keep: ["number 12"],
  },
  {
    id: "en-keypad-buttons",
    lang: "en",
    text: "The keypad has four buttons and one light.",
    codes: [],
    keep: ["four buttons", "one light"],
  },
];

export const LOOK_ALIKE_SNIPPETS: readonly CorpusEntry[] = [
  ...LOOK_ALIKE_SNIPPETS_002,
  ...GUIDE_LOOK_ALIKE_SNIPPETS,
];

export const RESTRICTED_VALUE_CORPUS: readonly CorpusEntry[] = [
  ...CODE_SNIPPETS,
  ...LOOK_ALIKE_SNIPPETS,
];
