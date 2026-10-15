export const dateFr = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
/** A DOI or doi.org link, as one comparable key ("10.1016/j.jacc.2025.11.005"). */
export const doiKey = (x: string) => x.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").trim();
