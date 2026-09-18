const rank={CRITICO:0,ALTO:1,MEDIO:2,BAJO:3}
export function compareActivities(a,b){
  const va=a.request_data.priority_validation?.factors||{},vb=b.request_data.priority_validation?.factors||{}
  return (a.priority ? rank[a.priority.level]??4 : -1)-(b.priority ? rank[b.priority.level]??4 : -1)
    ||(vb.c||0)-(va.c||0)||(vb.i||0)-(va.i||0)||(vb.n||0)-(va.n||0)
    ||a.requested_at.localeCompare(b.requested_at)||a.id-b.id
}
