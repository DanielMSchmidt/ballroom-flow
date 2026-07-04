// Share / invite catalog: the Share screen (US-024), the invite-redeem screen
// (US-023), and the signed-out SignInPrompt on the invite deep-link. See
// i18n/messages.ts for the pattern: `de: typeof en` makes a missing/extra
// German key a compile error. Role VALUES ("owner"/"editor"/…) stay canonical —
// only the display labels/blurbs are localized.
const en = {
  // SignInPrompt — the signed-out card inside the app shell (invite deep-link).
  signInInvitedTitle: "You’ve been invited to a choreo",
  signInTitle: "Sign in to build choreography",
  signInInvitedBody:
    "Sign in to open the shared choreography — Ballroom Flow keeps it in sync across your devices.",
  signInBody: "Ballroom Flow keeps your choreos in sync across your devices.",
  // InviteRedeem — /invite/:token.
  redeemErrorTitle: "This invite can’t be opened",
  redeemErrorBody: "The link may be invalid, expired, or already used. Ask for a fresh invite.",
  redeemGoToOverview: "Go to my choreography",
  redeemDowngradedTitle: "Joined as a commenter",
  redeemDowngradedBody:
    "You’re at your limit of choreos you can edit on the free plan, so you’ve joined this routine as a commenter — you can read and comment, but not edit it. Upgrade to edit more routines.",
  redeemOpenChoreo: "Open choreo",
  redeemJoiningTitle: "Joining…",
  redeemJoiningBody: "Adding this choreo to your list.",
  // Share screen.
  shareRegionLabel: "Share this choreo",
  title: "Share",
  partnersHeading: "Partners on this choreo",
  you: "You",
  youRole: (role: string) => `you · ${role}`,
  loadingMembers: "Loading members…",
  emptyRoster: "Just you so far. Invite someone below.",
  roles: {
    owner: { label: "Owner", pill: "owner", blurb: "Full control, including sharing." },
    editor: { label: "Editor", pill: "editor", blurb: "Can edit structure, figures, and timing." },
    commenter: {
      label: "Commenter",
      pill: "commenter",
      blurb: "Can add annotations, but not edit.",
    },
    viewer: { label: "Viewer", pill: "viewer", blurb: "Can view the choreo, read-only." },
  },
  inviteRoleLabels: {
    viewer: "Viewer — can view",
    commenter: "Commenter — can annotate",
    editor: "Editor — can edit",
  },
  coEditExplainer:
    "Everyone on this choreo edits the same figures — changes stay inside this choreo. To branch off on your own, fork it: a frozen, independent copy.",
  fork: "Fork — make it your own",
  inviteRoleSelectLabel: "Role",
  createLink: "Create link",
  copy: "Copy",
  inviteCopied: "Invite link copied",
  inviteSomeone: "+ invite someone",
  removeMember: "Remove",
  removeMemberAria: (name: string) => `Remove ${name}`,
  removeConfirmTitle: "Remove this person?",
  removeConfirmBody: (name: string) =>
    `${name} will lose access to this choreo. You can invite them again with a new link.`,
  cancel: "Cancel",
  removeAccess: "Remove access",
};

const de: typeof en = {
  // SignInPrompt.
  signInInvitedTitle: "Du wurdest zu einer Choreo eingeladen",
  signInTitle: "Melde dich an, um Choreografien zu erstellen",
  signInInvitedBody:
    "Melde dich an, um die geteilte Choreografie zu öffnen — Ballroom Flow hält sie auf allen deinen Geräten synchron.",
  signInBody: "Ballroom Flow hält deine Choreos auf allen deinen Geräten synchron.",
  // InviteRedeem.
  redeemErrorTitle: "Diese Einladung kann nicht geöffnet werden",
  redeemErrorBody:
    "Der Link ist womöglich ungültig, abgelaufen oder schon benutzt. Bitte um eine neue Einladung.",
  redeemGoToOverview: "Zu meinen Choreos",
  redeemDowngradedTitle: "Als Kommentator beigetreten",
  redeemDowngradedBody:
    "Du bist am Limit der Choreos, die du im Gratis-Tarif bearbeiten kannst — deshalb bist du dieser Choreo als Kommentator beigetreten: Du kannst lesen und kommentieren, aber nicht bearbeiten. Upgrade, um mehr Choreos zu bearbeiten.",
  redeemOpenChoreo: "Choreo öffnen",
  redeemJoiningTitle: "Trete bei …",
  redeemJoiningBody: "Diese Choreo wird deiner Liste hinzugefügt.",
  // Share screen.
  shareRegionLabel: "Diese Choreo teilen",
  title: "Teilen",
  partnersHeading: "Partner an dieser Choreo",
  you: "Du",
  youRole: (role) => `du · ${role}`,
  loadingMembers: "Lädt Mitglieder …",
  emptyRoster: "Bisher nur du. Lade unten jemanden ein.",
  roles: {
    owner: { label: "Inhaber", pill: "Inhaber", blurb: "Volle Kontrolle, einschließlich Teilen." },
    editor: {
      label: "Bearbeiter",
      pill: "Bearbeiter",
      blurb: "Kann Struktur, Figuren und Timing bearbeiten.",
    },
    commenter: {
      label: "Kommentator",
      pill: "Kommentator",
      blurb: "Kann Anmerkungen hinzufügen, aber nichts bearbeiten.",
    },
    viewer: {
      label: "Betrachter",
      pill: "Betrachter",
      blurb: "Kann die Choreo ansehen, schreibgeschützt.",
    },
  },
  inviteRoleLabels: {
    viewer: "Betrachter — kann ansehen",
    commenter: "Kommentator — kann anmerken",
    editor: "Bearbeiter — kann bearbeiten",
  },
  coEditExplainer:
    "Alle an dieser Choreo bearbeiten dieselben Figuren — Änderungen bleiben innerhalb dieser Choreo. Um eigene Wege zu gehen, zweige sie ab: eine eingefrorene, unabhängige Kopie.",
  fork: "Abzweigen — mach es zu deinem eigenen",
  inviteRoleSelectLabel: "Rolle",
  createLink: "Link erstellen",
  copy: "Kopieren",
  inviteCopied: "Einladungslink kopiert",
  inviteSomeone: "+ jemanden einladen",
  removeMember: "Entfernen",
  removeMemberAria: (name) => `${name} entfernen`,
  removeConfirmTitle: "Diese Person entfernen?",
  removeConfirmBody: (name) =>
    `${name} verliert den Zugriff auf diese Choreo. Du kannst sie mit einem neuen Link erneut einladen.`,
  cancel: "Abbrechen",
  removeAccess: "Zugriff entfernen",
};

export const shareMessages = { en, de };
