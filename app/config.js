/* Rodokmeňovec – nastavenia. */
(function () {
  'use strict';
  const RK = (globalThis.RK = globalThis.RK || {});
  RK.Config = {
    // OAuth Client ID z Google Cloud konzoly (typ „Webová aplikácia“).
    // Prázdne = prihlásenie cez Google je vypnuté a ostáva len práca s priečinkom na počítači.
    googleClientId: '',
  };
})();
