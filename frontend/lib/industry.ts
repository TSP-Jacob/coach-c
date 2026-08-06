// Industry mode — a per-organization setting that drives terminology.
// This file is the single place display labels live; adjust the wording here
// and it changes everywhere the maps are consumed (Clients page, etc.).

export type IndustryMode = "home_services" | "real_estate";

export const DEFAULT_MODE: IndustryMode = "home_services";

export const INDUSTRY_MODES: IndustryMode[] = ["home_services", "real_estate"];

// Label shown in the org-profile dropdown.
export const INDUSTRY_LABELS: Record<IndustryMode, string> = {
  home_services: "Home Services",
  real_estate:   "Real Estate",
};

// Coerce any stored/unknown value to a supported mode.
export function normalizeMode(mode?: string | null): IndustryMode {
  return mode === "real_estate" || mode === "home_services" ? mode : DEFAULT_MODE;
}

// Client "type" (DB enum buyer/seller/both) → per-industry display label.
export const CLIENT_TYPE_LABELS: Record<IndustryMode, Record<string, string>> = {
  real_estate: {
    buyer:  "Buyer",
    seller: "Seller",
    both:   "Buyer & Seller",
  },
  home_services: {
    buyer:  "Residential",
    seller: "Commercial",
    both:   "Both",
  },
};

// Call "type" (DB enum) → per-industry display label. Home Services keeps the
// same underlying buckets but with neutral, non-real-estate wording.
export const CALL_TYPE_LABELS: Record<IndustryMode, Record<string, string>> = {
  real_estate: {
    prospecting:        "Prospecting",
    buyer_consultation: "Buyer Consult",
    seller_listing:     "Seller Listing",
    followup:           "Follow-Up",
    negotiation:        "Negotiation",
    post_closing:       "Post-Closing",
    unknown:            "Call",
  },
  home_services: {
    prospecting:        "New Enquiry",
    buyer_consultation: "Consultation",
    seller_listing:     "Estimate",
    followup:           "Follow-Up",
    negotiation:        "Quote Discussion",
    post_closing:       "Post-Service",
    unknown:            "Call",
  },
};

// Section labels for the Leads and Agents areas (nav + page headers).
export const SECTION_LABELS: Record<IndustryMode, {
  leads: string;
  agents: string;
  leadsEmpty: string;
  agentsEmpty: string;
  dashboardLeads: string;
}> = {
  real_estate: {
    leads:          "Leads",
    agents:         "Agents",
    leadsEmpty:     "No leads yet. Leads are created automatically from new callers and Home Value submissions.",
    agentsEmpty:    "No agents found.",
    dashboardLeads: "New Leads",
  },
  home_services: {
    leads:          "New Jobs",
    agents:         "Employees",
    leadsEmpty:     "No new jobs yet. Jobs are created automatically from new callers and Home Value submissions.",
    agentsEmpty:    "No employees found.",
    dashboardLeads: "New Jobs",
  },
};

export function clientTypeLabel(mode: IndustryMode, type?: string): string {
  return CLIENT_TYPE_LABELS[mode][type ?? ""] ?? type ?? "";
}

export function callTypeLabel(mode: IndustryMode, type?: string): string {
  return CALL_TYPE_LABELS[mode][type ?? ""] ?? "Call";
}
