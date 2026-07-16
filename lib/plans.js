// Paket limitleri — tek yerden yönetilsin diye ayrı dosyada.
// Pazaryeri sayısı hiçbir pakette sınırlanmıyor (hepsi açık), sadece çalışan ve depo
// sayısı pakete göre değişiyor.

const PLAN_LIMITS = {
  start:  { label: 'Start',  employeeLimit: 3,    warehouseLimit: 1,    basePrice: 299,  perOrder: 0.50 },
  growth: { label: 'Growth', employeeLimit: 10,   warehouseLimit: 3,    basePrice: 699,  perOrder: 0.35 },
  pro:    { label: 'Pro',    employeeLimit: null, warehouseLimit: null, basePrice: 1499, perOrder: 0.25 },
};

function getPlanLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.start;
}

module.exports = { PLAN_LIMITS, getPlanLimits };
