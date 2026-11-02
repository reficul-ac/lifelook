import type {PreparedForecastYear,ForecastYearStep} from './types';
/** Annual tax/allocation is accepted before a single monthly balance is posted. */
export function postForecastMonths(prepared:PreparedForecastYear):ForecastYearStep {
 for(let month=1;month<=12;month++)prepared.postMonth(month);
 return prepared.finish();
}
