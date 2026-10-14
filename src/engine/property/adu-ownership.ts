import type { AduProject, PlanDocument, Property, RentalUnit } from '../model/plan';

/** Ownership is derived from the property's project; no competing stored links. */
export function getAduProjects(plan:PlanDocument):readonly {property:Property;project:AduProject;rental:RentalUnit}[] {
  return plan.properties.flatMap(property=>{
    const project=property.aduProject;
    const rental=project && plan.rentals.find(unit=>unit.id===project.rentalId && unit.propertyId===property.id);
    return project && rental ? [{property,project,rental}] : [];
  });
}
export function findAduOwner(plan:PlanDocument,recordId:string):{propertyId:string;projectId:string}|undefined {
  for(const {property,project,rental} of getAduProjects(plan)) {
    const financing=project.financing;
    const owned=[project.id,rental.id,...project.costs.map(x=>x.id),...project.sharedExpenseOverrides.map(x=>x.id),
      ...project.propertyTax.paymentYears.flatMap(x=>x.payments.map(p=>p.id)),
      ...(financing?[financing.id,...financing.draws.map(x=>x.id),...financing.interestTaxRows.map(x=>x.id)]:[]),
      ...plan.expenses.filter(x=>x.rentalId===rental.id).map(x=>x.id)];
    if(owned.includes(recordId)) return {propertyId:property.id,projectId:project.id};
  }
  return undefined;
}
