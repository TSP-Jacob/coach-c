// Lightweight i18n — English strings are used as translation keys directly,
// so wrapping any existing JSX text in t() is always safe: an untranslated
// string just falls back to itself instead of breaking.
//
// AI-generated content (coaching reports, call summaries, dashboard insights,
// the assistant) is translated server-side based on the agent's saved
// language (see backend/app/services/coaching.py) — this file only covers
// static UI chrome (nav, buttons, headers, labels).

export type Language = "en" | "fr";

export const DEFAULT_LANGUAGE: Language = "en";

export function normalizeLanguage(v?: string | null): Language {
  return v === "fr" ? "fr" : "en";
}

// English text -> French translation. Add entries here as new UI surfaces
// are translated; anything missing just renders in English.
const FR: Record<string, string> = {
  // Sidebar / nav
  "Dashboard": "Tableau de bord",
  "Leads": "Prospects",
  "New Jobs": "Nouveaux travaux",
  "Calls": "Appels",
  "Clients": "Clients",
  "Follow-Ups": "Suivis",
  "Tasks": "Tâches",
  "Assistant": "Assistant",
  "Agents": "Agents",
  "Employees": "Employés",
  "Notes": "Notes",
  "Organization": "Organisation",
  "Guidelines": "Directives",
  "Get the App": "Obtenir l'appli",
  "Team": "Équipe",
  "Phone Numbers": "Numéros de téléphone",
  "Billing": "Facturation",
  "Billing (Admin)": "Facturation (Admin)",
  "Sign out": "Se déconnecter",

  // Common
  "Loading…": "Chargement…",
  "Save": "Enregistrer",
  "Cancel": "Annuler",
  "Delete": "Supprimer",
  "Edit": "Modifier",
  "Close": "Fermer",
  "Search": "Rechercher",
  "New": "Nouveau",

  // Dashboard
  "Good morning": "Bonjour",
  "Good afternoon": "Bon après-midi",
  "Good evening": "Bonsoir",
  "Coach-C · by Chardin Systems": "Coach-C · par Chardin Systems",
  "New Leads": "Nouveaux prospects",
  "Follow Ups": "Suivis",
  "awaiting response": "en attente de réponse",
  "scheduled": "prévu(s)",
  "AI Overview": "Aperçu IA",
  "Thinking…": "Réflexion en cours…",

  // Leads / New Jobs page
  "All sources": "Toutes les sources",
  "Call": "Appel",
  "Home Value": "Home Value",
  "Assistant Source": "Assistant",
  "All statuses": "Tous les statuts",
  "Contacted": "Contacté",
  "Converted": "Converti",
  "Lost": "Perdu",
  "All organizations": "Toutes les organisations",
  "Lead": "Prospect",
  "Source": "Source",
  "Contact": "Contact",
  "Assigned Agent": "Agent assigné",
  "Action": "Action",
  "Unassigned": "Non assigné",
  "Log Response": "Enregistrer une réponse",
  "How did you reach out?": "Comment avez-vous communiqué?",
  "Phone Call": "Appel téléphonique",
  "Text Message": "Message texte",
  "Text": "Texte",
  "Email": "Courriel",
  "In-Person": "En personne",
  "View property ↓": "Voir la propriété ↓",
  "Hide details ↑": "Masquer les détails ↑",
  "Address": "Adresse",
  "Property Type": "Type de propriété",
  "Estimated Value": "Valeur estimée",
  "Timeline to Sell": "Délai de vente",
  "Wanted": "Souhaité le",
  "No leads yet. Leads are created automatically from new callers and Home Value submissions.":
    "Aucun prospect pour le moment. Les prospects sont créés automatiquement à partir des nouveaux appelants et des soumissions Home Value.",
  "No new jobs yet. Jobs are created automatically from new callers and Home Value submissions.":
    "Aucun nouveau travail pour le moment. Les travaux sont créés automatiquement à partir des nouveaux appelants et des soumissions Home Value.",

  // Agents / Employees page
  "Performance overview for your team": "Aperçu de la performance de votre équipe",
  "Team Members": "Membres de l'équipe",
  "Total Calls": "Total des appels",
  "Avg Score": "Score moyen",
  "calls": "appels",
  "No agents found.": "Aucun agent trouvé.",
  "No employees found.": "Aucun employé trouvé.",

  // Call type labels (industry.ts CALL_TYPE_LABELS values, both industries)
  "Prospecting": "Prospection",
  "Buyer Consult": "Consultation acheteur",
  "Seller Listing": "Inscription vendeur",
  "Follow-Up": "Suivi",
  "Negotiation": "Négociation",
  "Post-Closing": "Après-clôture",
  "Unknown": "Inconnu",
  "New Enquiry": "Nouvelle demande",
  "Consultation": "Consultation",
  "Estimate": "Estimation",
  "Quote Discussion": "Discussion de soumission",
  "Post-Service": "Après-service",

  // Calls list + detail page
  "+ Upload Call": "+ Téléverser un appel",
  "All types": "Tous les types",
  "All time": "Tout le temps",
  "This week": "Cette semaine",
  "This month": "Ce mois-ci",
  "Last 3 months": "3 derniers mois",
  "All scores": "Tous les scores",
  "High (75+)": "Élevé (75+)",
  "Mid (50–74)": "Moyen (50–74)",
  "Low (<50)": "Faible (<50)",
  "Clear filters": "Effacer les filtres",
  "No client linked": "Aucun client lié",
  "Search by client name or call type…": "Rechercher par nom de client ou type d'appel…",
  "No calls yet. Upload your first recording.": "Aucun appel pour le moment. Téléversez votre premier enregistrement.",
  "No calls match your filters.": "Aucun appel ne correspond à vos filtres.",
  "Call deleted": "Appel supprimé",
  "Call uploaded — analysis started": "Appel téléversé — analyse commencée",
  "of": "sur",
  "recordings": "enregistrements",
  "Inbound": "Entrant",
  "Outbound": "Sortant",
  "Missed": "Manqué",
  "Unclassified": "Non classé",
  "Unclassified call": "Appel non classé",
  "Unknown client": "Client inconnu",
  "Coaching Report": "Rapport de coaching",
  "Transcript": "Transcription",
  "Transcribing audio…": "Transcription de l'audio…",
  "Analyzing call against guidelines…": "Analyse de l'appel selon les directives…",
  "Uploading…": "Téléversement…",
  "Analyzing": "Analyse en cours",
  "Processing failed": "Échec du traitement",
  "Status": "Statut",
  "Agent": "Agent",
  "Strong": "Fort",
  "Fair": "Correct",
  "Needs work": "À améliorer",
  "This call rang and was never answered — nothing was recorded.":
    "Cet appel a sonné et n'a jamais été répondu — rien n'a été enregistré.",
  "This call was placed but never picked up — nothing was recorded.":
    "Cet appel a été passé mais jamais répondu — rien n'a été enregistré.",
  "Couldn't load this call": "Impossible de charger cet appel",
  "Call analysis complete ✓": "Analyse de l'appel terminée ✓",
  "Processing failed — check error message": "Échec du traitement — voir le message d'erreur",
  "Status updated": "Statut mis à jour",
  "Agent assigned": "Agent assigné",
  "Engaged": "Engagé",
  "Follow-Up Needed": "Suivi requis",
  "Negotiating": "En négociation",

  // Follow-Ups page
  "Overdue": "En retard",
  "This Week": "Cette semaine",
  "Next Week": "Semaine prochaine",
  "Later": "Plus tard",
  "Reschedule": "Reporter",
  "Mark Complete": "Marquer complété",
  "No follow-ups scheduled. Set a follow-up date from a client's profile in Clients, or ask the assistant to schedule one.":
    "Aucun suivi prévu. Définissez une date de suivi à partir du profil d'un client dans Clients, ou demandez à l'assistant d'en planifier un.",

  // Tasks page
  "New Task": "Nouvelle tâche",
  "Assign To": "Assigner à",
  "Title": "Titre",
  "Description (optional)": "Description (facultatif)",
  "Due Date (optional)": "Date d'échéance (facultatif)",
  "Select teammate…": "Sélectionner un coéquipier…",
  "Create with Voice": "Créer avec la voix",
  "or fill it in manually": "ou remplir manuellement",
  "← use voice instead": "← utiliser la voix à la place",
  "Create Task": "Créer la tâche",
  "Creating…": "Création…",
  "No teammates yet.": "Aucun coéquipier pour le moment.",
  "No tasks assigned yet.": "Aucune tâche assignée pour le moment.",
  "No tasks assigned to you right now.": "Aucune tâche ne vous est assignée pour le moment.",
  "Say who it's for, what needs doing, and — if there is one — when it's due.":
    "Dites pour qui c'est, ce qu'il faut faire et, s'il y en a une, la date d'échéance.",
  "e.g. Call back the Hendersons": "p. ex. Rappeler les Henderson",
  "Couldn't create the task. Try again.": "Impossible de créer la tâche. Réessayez.",
  "Pending": "En attente",
  "In Progress": "En cours",
  "Done": "Terminé",
  "open": "ouverte(s)",
  "total": "total",
  "overdue": "en retard",
  "from": "de",

  // Clients page
  "Recently Added": "Ajoutés récemment",
  "Search by name, phone, or email…": "Rechercher par nom, téléphone ou courriel…",
  "Client": "Client",
  "Calls · Score": "Appels · Score",
  "No clients yet. Clients are created automatically when calls are analyzed.":
    "Aucun client pour le moment. Les clients sont créés automatiquement lors de l'analyse des appels.",
  "No clients match your search.": "Aucun client ne correspond à votre recherche.",
  "No activity yet": "Aucune activité pour le moment",
  "avg": "moy.",
  "Client Status": "Statut du client",
  "Contact Info": "Coordonnées",
  "Latest Summary": "Dernier résumé",
  "Note": "Note",
  "No activity yet.": "Aucune activité pour le moment.",
  "Consent": "Consentement",
  "Communications": "Communications",
  "No recorded calls yet.": "Aucun appel enregistré pour le moment.",
  "Add address…": "Ajouter une adresse…",
  "Create Follow-Up…": "Créer un suivi…",
  "Consent Record": "Registre de consentement",
  "Recorded:": "Enregistré le :",
  "Log sent to:": "Journal envoyé à :",
  "Homeowner email:": "Courriel du propriétaire :",
  "Homeowner phone:": "Téléphone du propriétaire :",
  "Consent text shown to homeowner": "Texte de consentement présenté au propriétaire",
  "Today": "Aujourd'hui",
  "Yesterday": "Hier",

  // Call detail — summary card
  "Call Summary": "Résumé de l'appel",
};

export function translate(language: Language, text: string): string {
  if (language !== "fr") return text;
  return FR[text] ?? text;
}
