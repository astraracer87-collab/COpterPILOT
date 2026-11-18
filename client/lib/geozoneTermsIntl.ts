import type { GlossaryEntry } from "@/lib/glossary";

// Internationale Geozonen-Begriffe: fremdsprachige Zonentyp-Bezeichnungen, wie sie
// auf amtlichen Drohnenkarten im Ausland erscheinen, mit deutscher Bedeutung.
// Eigene Übersetzungen/Erklärungen. Begriffsauswahl orientiert an gängigen
// Karten (ES, FR, NL, DK, SE, IT). Datenquelle-Hinweis siehe Einstellungen → Datenquellen.

export const GEOZONE_TERMS_INTL: GlossaryEntry[] = [
  // Spanien (ENAIRE)
  { term: "Zona de Control (CTR)", definition: "Spanisch für Kontrollzone – kontrollierter Luftraum um einen Flughafen; Flug nur mit Freigabe." },
  { term: "Aeropuerto", definition: "Spanisch für Flughafen. Rund um den Flughafen gelten Schutzabstände und meist Flugverbote für Drohnen." },
  { term: "Helipuerto", definition: "Spanisch für Hubschrauberlandeplatz; im Umfeld gelten Abstands- und Höhenbeschränkungen." },
  { term: "Espacio Natural", definition: "Spanisch für Naturschutzraum / Naturpark; Drohnenflug häufig genehmigungspflichtig oder verboten." },
  { term: "Entorno", definition: "Spanisch für Umgebung/Umfeld – Pufferbereich um ein geschütztes Objekt oder einen Flugplatz." },
  { term: "Gestor", definition: "Spanisch für Betreiber/Verwalter – die für eine Geozone zuständige Stelle (Kontaktangabe auf der Karte)." },
  // Frankreich (Géoportail)
  { term: "Aérodrome", definition: "Französisch für Flugplatz; rund um Aerodrome gelten in Frankreich Schutzzonen für Drohnen." },
  { term: "Zone Danger / Danger", definition: "Französisch für Gefahrengebiet – Bereich mit möglichen Gefahren für den Flug (z. B. Schießübungen)." },
  { term: "Actif / Actif H24", definition: "Französisch für aktiv bzw. durchgehend aktiv (H24 = 24 Stunden)." },
  { term: "Interdiction / Interdit", definition: "Französisch für Verbot / verboten – gesperrter Bereich." },
  // Niederlande (GoDrone)
  { term: "Beperkt gebied", definition: "Niederländisch für Gebiet mit Einschränkungen – Drohnenflug nur unter Auflagen oder mit Genehmigung." },
  { term: "Verboden gebied", definition: "Niederländisch für Sperrgebiet – Drohnenflug untersagt." },
  { term: "Gecontroleerd luchtruim", definition: "Niederländisch für kontrollierter Luftraum (z. B. CTR); Flug nur mit Freigabe." },
  { term: "Gevaarlijk gebied", definition: "Niederländisch für Gefahrengebiet." },
  { term: "Luchthaven", definition: "Niederländisch für Flughafen." },
  // Dänemark (Droneluftrum)
  { term: "Droneflyvning forbudt", definition: "Dänisch für „Drohnenflug verboten“ – gesperrte Zone." },
  { term: "Flyvestation", definition: "Dänisch für (Militär-)Flugplatz / Fliegerhorst." },
  { term: "Flyveplads", definition: "Dänisch für Flugplatz." },
  { term: "Helikopterplads", definition: "Dänisch für Hubschrauberlandeplatz." },
  { term: "Fuglebeskyttelsesområde", definition: "Dänisch für Vogelschutzgebiet; Drohnenflug häufig untersagt oder genehmigungspflichtig." },
  { term: "Naturområde", definition: "Dänisch für Naturgebiet/Schutzgebiet." },
  // Schweden (LFV Dronekarta)
  { term: "Flygplats", definition: "Schwedisch für Flugplatz." },
  { term: "Helikopterflygplats", definition: "Schwedisch für Hubschrauberflugplatz." },
  { term: "Kontrollzon", definition: "Schwedisch für Kontrollzone (CTR)." },
  { term: "Restriktionsområde", definition: "Schwedisch für Beschränkungsgebiet – Flug nur eingeschränkt erlaubt." },
  // Italien (d-flight)
  { term: "Zona vietata", definition: "Italienisch für Verbotszone – Drohnenflug untersagt." },
  { term: "Area di controllo", definition: "Italienisch für Kontrollbereich/Kontrollzone." },
  { term: "Aeroporto", definition: "Italienisch für Flughafen." },
  { term: "Zona pericolosa", definition: "Italienisch für Gefahrengebiet." },
];
