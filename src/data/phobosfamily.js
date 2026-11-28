// City State Phobos is one weighted environment family. The city selection code chooses
// one of these district/environment combinations after the family itself is selected.
export const PHOBOS_ENVIRONMENTS = Object.freeze([
  { id: 'city', name: 'City State', act: 1, pack: 'ph_city', eligible: ['barbican', 'rookeries', 'chainmarket', 'wharf', 'tanners', 'boneyards', 'barracks', 'mages', 'dukes', 'approach'] },
  { id: 'sunscorched', name: 'Sunscorched', act: 2, pack: 'ph_rich', eligible: ['barbican', 'rookeries', 'chainmarket', 'tanners', 'boneyards', 'barracks', 'mages', 'dukes', 'approach'] },
  { id: 'frostbound', name: 'Frostbound', act: 3, pack: 'ph_marches', eligible: ['barbican', 'rookeries', 'chainmarket', 'wharf', 'boneyards', 'barracks', 'mages', 'dukes', 'approach'] },
  { id: 'hellfallen', name: 'Hellfallen', act: 4, pack: 'ph_cinder', eligible: ['barbican', 'cinder', 'rookeries', 'chainmarket', 'tanners', 'boneyards', 'barracks', 'mages', 'dukes', 'approach'] },
]);

export const PHOBOS_DISTRICTS = Object.freeze([
  { id: 'barbican', name: 'The Barbican', style: 'fortress' },
  { id: 'cinder', name: 'The Cinder Quarter', style: 'ruined' },
  { id: 'rookeries', name: 'The Rookeries', style: 'dense' },
  { id: 'chainmarket', name: 'Chainmarket', style: 'market' },
  { id: 'wharf', name: 'The Drowned Wharf', style: 'canal' },
  { id: 'tanners', name: "The Tanners' Steps", style: 'industrial' },
  { id: 'boneyards', name: 'The Bone Yards', style: 'graveyard' },
  { id: 'barracks', name: 'The Barracks Ward', style: 'military' },
  { id: 'mages', name: "The Mages' Rise", style: 'arcane' },
  { id: 'dukes', name: "Dukes' Row", style: 'estate' },
  { id: 'approach', name: 'The Castle Approach', style: 'fortress' },
]);

export const PHOBOS_VARIANTS = Object.freeze(PHOBOS_ENVIRONMENTS.flatMap((environment) =>
  PHOBOS_DISTRICTS.filter((district) => environment.eligible.includes(district.id)).map((district) => ({
    id: `phobos_${environment.id}_${district.id}`,
    name: `${environment.name} Phobos — ${district.name}`,
    phobos: true,
    phobosAct: environment.act,
    phobosEnvironment: environment.id,
    phobosDistrict: district.id,
    phobosDistrictName: district.name,
    phobosDistrictStyle: district.style,
    pack: environment.pack,
  }))));

export const PHOBOS_SELECTION_TOKEN = 'phobos-city-family';
export const phobosToken = (id) => PHOBOS_VARIANTS.some((b) => b.id === id) ? PHOBOS_SELECTION_TOKEN : id;
export function phobosEligibleForAct(act) { return PHOBOS_VARIANTS.filter((b) => b.phobosAct === Number(act)); }
export function choosePhobosVariant(pool, { act = null, lastId = null, random = Math.random } = {}) {
  let options = (pool || PHOBOS_VARIANTS).filter((b) => b.phobos && (act == null || b.phobosAct === Number(act)));
  if (!options.length) return null;
  const fresh = options.filter((b) => b.id !== lastId);
  if (fresh.length) options = fresh;
  const value = Number(random());
  return options[Math.min(options.length - 1, Math.max(0, Math.floor((Number.isFinite(value) ? value : 0) * options.length)))];
}
