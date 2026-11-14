import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CTR_ZONE_CONTACTS,
  getContactsForLayerId,
  GEOZONE_REGULATORY_INFO,
} from "../geozoneRegulatoryInfo";

const OFFICIAL_CTR_AIRPORTS = {
  DFS: [
    "Berlin Brandenburg",
    "Bremen",
    "Dresden",
    "Düsseldorf",
    "Erfurt",
    "Frankfurt Main",
    "Hamburg",
    "Hannover",
    "Köln",
    "Leipzig",
    "München",
    "Münster",
    "Nürnberg",
    "Saarbrücken",
    "Stuttgart",
  ],
  "DFS Aviation": [
    "Braunschweig",
    "Dortmund",
    "Friedrichshafen",
    "Karlsruhe",
    "Lahr",
    "Memmingen",
    "Mönchengladbach",
    "Niederrhein",
    "Paderborn",
  ],
  "Austro Control": [
    "Augsburg",
    "Frankfurt/Hahn",
    "Heringsdorf",
    "Lübeck",
    "Hof",
    "Kassel",
    "Sylt",
  ],
  TRIAC: ["Oberpfaffenhofen"],
} as const;

const CONTACT_LABEL_PREFIX: Record<keyof typeof OFFICIAL_CTR_AIRPORTS, string> =
  {
    DFS: "DFS —",
    "DFS Aviation": "DFS Aviation —",
    "Austro Control": "Austro Control —",
    TRIAC: "TRIAC —",
  };

describe("CTR-Kontakte nach Land", () => {
  it("gleicht die vollständige Flughafenzuordnung mit den vier CTR-NfL ab", () => {
    const expectedAssignments = Object.entries(OFFICIAL_CTR_AIRPORTS).flatMap(
      ([provider, airports]) =>
        airports.map((airport) => ({ provider, airport })),
    );
    const expectedAirportNames = expectedAssignments.map(
      ({ airport }) => airport,
    );

    assert.equal(
      new Set(expectedAirportNames).size,
      expectedAirportNames.length,
      "Jeder Flughafen darf in den offiziellen Anbieterlisten nur einmal vorkommen",
    );

    for (const [provider, airports] of Object.entries(OFFICIAL_CTR_AIRPORTS)) {
      for (const airport of airports) {
        const contacts = CTR_ZONE_CONTACTS[airport];
        assert.ok(
          contacts,
          `${airport} aus dem NfL von ${provider} muss in der Kontaktliste stehen`,
        );

        if (provider === "Austro Control") {
          assert.deepEqual(
            contacts,
            [],
            `${airport} ist Austro Control zugeordnet, aber es gibt hier keine verifizierten lokalen Tower-Kontakte`,
          );
          continue;
        }

        assert.ok(
          contacts.length > 0,
          `${airport} muss lokale Kontakte für ${provider} enthalten`,
        );
        assert.ok(
          contacts.every((contact) =>
            contact.label.startsWith(
              CONTACT_LABEL_PREFIX[
                provider as keyof typeof OFFICIAL_CTR_AIRPORTS
              ],
            ),
          ),
          `${airport} darf ausschließlich ${provider}-Kontakte enthalten`,
        );
      }
    }

    const expectedProvidersByAirport = new Map(
      expectedAssignments.map(({ provider, airport }) => [airport, provider]),
    );
    for (const [airport, contacts] of Object.entries(CTR_ZONE_CONTACTS)) {
      const providers = new Set(
        Object.entries(CONTACT_LABEL_PREFIX)
          .filter(([, prefix]) =>
            contacts.some((contact) => contact.label.startsWith(prefix)),
          )
          .map(([provider]) => provider),
      );

      assert.ok(
        providers.size <= 1,
        `${airport} darf nicht mehreren Anbietern zugeordnet sein`,
      );
      const expectedProvider = expectedProvidersByAirport.get(airport);
      if (expectedProvider === "Austro Control") {
        assert.equal(
          providers.size,
          0,
          `${airport} darf keine unbelegten Austro-Control-Lokalkontakte enthalten`,
        );
      } else if (expectedProvider) {
        assert.deepEqual(
          [...providers],
          [expectedProvider],
          `${airport} ist dem falschen Anbieter zugeordnet`,
        );
      } else {
        assert.equal(
          contacts.length,
          0,
          `${airport} darf ohne Eintrag in den vier NfL-Flughafenlisten keine lokalen Anbieter-Kontakte haben`,
        );
        assert.equal(
          providers.size,
          0,
          `${airport} ist in keiner der vier offiziellen NfL-Flughafenlisten enthalten`,
        );
      }
    }

    const mappedProviderContacts = Object.values(CTR_ZONE_CONTACTS)
      .flat()
      .filter((contact) =>
        Object.values(CONTACT_LABEL_PREFIX).some((prefix) =>
          contact.label.startsWith(prefix),
        ),
      )
      .map(({ type, label, value }) => ({ type, label, value }))
      .sort(
        (a, b) =>
          a.label.localeCompare(b.label) || a.type.localeCompare(b.type),
      );
    const generalProviderContacts =
      GEOZONE_REGULATORY_INFO.kontrollzonen.contacts
        .filter((contact) =>
          Object.values(CONTACT_LABEL_PREFIX).some((prefix) =>
            contact.label.startsWith(prefix),
          ),
        )
        .map(({ type, label, value }) => ({ type, label, value }))
        .sort(
          (a, b) =>
            a.label.localeCompare(b.label) || a.type.localeCompare(b.type),
        );
    assert.deepEqual(
      generalProviderContacts,
      mappedProviderContacts,
      "Die allgemeine CTR-Kontaktliste muss dieselben NfL-geprüften Anbieterzuordnungen zeigen",
    );
  });

  it("zeigt in Österreich nur allgemeine, verifizierte Dronespace-Kanäle", () => {
    const contacts = getContactsForLayerId("kontrollzonen", "Wien", "AT");
    assert.deepEqual(
      contacts.map(({ type, value }) => ({ type, value })),
      [
        { type: "email", value: "dronespace@austrocontrol.at" },
        { type: "phone", value: "+43517037111" },
        { type: "web", value: "https://utm.dronespace.at/avm/" },
      ],
    );
    assert.ok(
      contacts.every((contact) => contact.label.includes("keine lokale")),
    );
    assert.ok(contacts.every((contact) => !contact.value.includes("@dfs.de")));
  });

  it("zeigt dieselben gekennzeichneten Austro-Control-Kanäle im CTR-Infodialog ohne Zonennamen", () => {
    const contacts = getContactsForLayerId("kontrollzonen", undefined, "AT");
    assert.equal(contacts.length, 3);
    assert.ok(
      contacts.every((contact) => contact.label.includes("keine lokale")),
    );
    assert.ok(contacts.every((contact) => !contact.value.includes("@dfs.de")));
  });

  it("zeigt deutsche CTR-Kontakte nicht für unbekannte Länder", () => {
    assert.deepEqual(getContactsForLayerId("kontrollzonen", "Wien"), []);
    assert.deepEqual(
      getContactsForLayerId("kontrollzonen", "München", "CH"),
      [],
    );
  });

  it("behält die deutschen CTR-Kontakte für deutsche Standorte", () => {
    const contacts = getContactsForLayerId(
      "kontrollzonen",
      "Berlin Brandenburg",
      "DE",
    );
    assert.ok(contacts.some((contact) => contact.value === "tower-ber@dfs.de"));
    assert.ok(contacts.some((contact) => contact.value === "+493060916131"));
  });

  it("lässt eine gleichnamige deutsche CTR in Österreich nicht auf DFS-Kontakte auflösen", () => {
    const contacts = getContactsForLayerId("kontrollzonen", "München", "AT");
    assert.ok(contacts.length > 0);
    assert.ok(contacts.every((contact) => !contact.value.includes("@dfs.de")));
  });

  it("ordnet deutsche CTR-Kontakte nicht fälschlich Austro Control zu", () => {
    for (const name of [
      "München",
      "Münster",
      "Nürnberg",
      "Saarbrücken",
      "Stuttgart",
    ]) {
      const contacts = getContactsForLayerId("kontrollzonen", name, "DE");
      assert.ok(
        contacts.some((contact) => contact.label.startsWith("DFS —")),
        `${name} muss DFS-Kontakte behalten`,
      );
      assert.ok(
        contacts.every((contact) => !contact.label.includes("Austro")),
        `${name} darf keine Austro-Control-Kontakte enthalten`,
      );
    }
  });

  it("zeigt für Austro-Control-CTRs keine amtlich unbelegte Sammeladresse", () => {
    for (const name of [
      "Augsburg",
      "Frankfurt/Hahn",
      "Heringsdorf",
      "Lübeck",
      "Hof",
      "Kassel",
      "Sylt",
    ]) {
      assert.deepEqual(
        getContactsForLayerId("kontrollzonen", name, "DE"),
        [],
        `${name} darf keine unbelegte Sammeladresse anzeigen`,
      );
    }

    const allContacts = getContactsForLayerId("kontrollzonen", undefined, "DE");
    assert.ok(
      allContacts.every(
        (contact) => contact.value !== "flugplatzkontrolle@uas-betrieb.de",
      ),
    );
    assert.ok(
      GEOZONE_REGULATORY_INFO.kontrollzonen.links?.some((link) =>
        link.label.includes("Austro Control – 7 deutsche CTR"),
      ),
      "Die belegte Austro-Control-Zuständigkeit muss auf die offizielle NfL verweisen",
    );
  });
});
