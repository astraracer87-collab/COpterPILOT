/**
 * RC-Version: nur die Datentypen, die die App braucht. Die Datenbank-Tabellen
 * des Servers (Drizzle) sind hier bewusst nicht enthalten.
 */

export type LicenseDetailsInput = {
  firstName: string;
  lastName: string;
  identificationNumber: string;
  expirationDate: string;
  country?: string;
};

/** Hochgeladenes Dokument (PDF/Bild), in der RC-Version lokal als base64. */
export type DocumentRefJson = {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  objectPath?: string;
  dataBase64?: string;
};

/** Archivierte Fassung eines Pilotendokuments (AV/A2/Versicherung). */
export type ArchivedDocument = {
  type: "av" | "a2" | "insurance";
  bundesland?: string;
  label?: string;
  expirationDate?: string;
  activeFrom?: string;
  archivedAt: string;
  document?: DocumentRefJson | null;
  licenseDetails?: LicenseDetailsInput;
};
