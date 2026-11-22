export const SEIZURE_WARNING_SETTING = 'skipSeizureWarning';

export function shouldShowSeizureWarning(settings) {
  return settings?.[SEIZURE_WARNING_SETTING] !== true;
}

export function setSkipSeizureWarning(settings, skip) {
  settings[SEIZURE_WARNING_SETTING] = !!skip;
  return settings[SEIZURE_WARNING_SETTING];
}
