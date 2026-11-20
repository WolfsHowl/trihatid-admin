// driver-info.js — loads and renders a driver's details (name, phone, plate, body no., permit, rating).
// Needs supabase.js and notify.js loaded first.
(function () {
  const esc = window.TriUtil.esc;

  function firstOf() {
    for (let i = 0; i < arguments.length; i++) {
      const v = arguments[i];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return '';
  }

  async function getRating(driverId) {
    try {
      const { data } = await window._supabase
        .from('rides').select('rating')
        .eq('driver_id', driverId).not('rating', 'is', null);
      if (!data || !data.length) return { avg: null, count: 0 };
      const sum = data.reduce((s, r) => s + (Number(r.rating) || 0), 0);
      return { avg: sum / data.length, count: data.length };
    } catch (e) {
      return { avg: null, count: 0 };
    }
  }

  // Merges profile data with the denormalised copy stored on the ride row.
  async function getDetails(driverId, ride) {
    ride = ride || {};
    let p = {};
    if (driverId) {
      const { data } = await window._supabase
        .from('profiles').select('*').eq('id', driverId).maybeSingle();
      p = data || {};
    }
    const rating = driverId ? await getRating(driverId) : { avg: null, count: 0 };
    return {
      id: driverId,
      name: firstOf(p.fullname, p.full_name, p.name, ride.driver_name) || 'Tricycle Driver',
      phone: firstOf(p.phone, ride.driver_phone),
      avatar: firstOf(p.avatar_url, ride.driver_avatar_url),
      plate: firstOf(p.plate_no, p.plate, ride.driver_plate),
      body: firstOf(p.body_no, ride.driver_body_no),
      permit: firstOf(p.operator_permit_no, p.franchise_no, p.franchise, ride.driver_permit_no),
      rehistro: firstOf(p.rehistro_no),
      tricycle: firstOf(p.tricycle_url),
      rating
    };
  }

  function stars(avg) {
    const full = Math.round(avg);
    return '★'.repeat(full) + '☆'.repeat(5 - full);
  }

  function ratingHtml(r) {
    if (!r || !r.count) return '<span class="drv-rating none">New driver</span>';
    return `<span class="drv-rating"><span class="drv-stars">${stars(r.avg)}</span> ${r.avg.toFixed(1)} <small>(${r.count})</small></span>`;
  }

  function row(label, value) {
    return `<div class="drv-cell"><span>${esc(label)}</span><b>${value ? esc(value) : '—'}</b></div>`;
  }

  // Renders the full details block into `el`.
  function render(el, d, opts) {
    opts = opts || {};
    if (!el) return;
    const phone = d.phone ? d.phone.replace(/[^\d+]/g, '') : '';
    const complete = d.plate && d.body && d.permit;
    el.innerHTML = `
      <div class="drv-top">
        <div class="drv-avatar">${d.avatar
          ? `<img src="${esc(d.avatar)}" alt="">`
          : esc(d.name.charAt(0).toUpperCase())}</div>
        <div class="drv-id">
          <div class="drv-name">${esc(d.name)}</div>
          ${ratingHtml(d.rating)}
        </div>
        ${complete ? '<span class="drv-verified" title="Plate, body number and operator\'s permit on file">✔ Documents on file</span>' : ''}
      </div>
      <div class="drv-plate-row">
        <div class="plate-badge" aria-label="Plate number">${d.plate ? esc(d.plate.toUpperCase()) : 'NO PLATE'}</div>
        <div class="drv-plate-note">Check that this matches the tricycle before you ride.</div>
      </div>
      <div class="drv-grid">
        ${row('Body No.', d.body)}
        ${row("Operator's Permit", d.permit)}
        ${opts.showRehistro ? row('Rehistro (OR/CR)', d.rehistro) : ''}
        ${row('Mobile', d.phone)}
      </div>
      ${phone && opts.contact !== false ? `
        <div class="drv-actions">
          <a class="drv-btn" href="tel:${esc(phone)}">Call</a>
          <a class="drv-btn" href="sms:${esc(phone)}">Text</a>
        </div>` : ''}
      ${d.tricycle && opts.photo !== false ? `<img class="drv-trike" src="${esc(d.tricycle)}" alt="Tricycle">` : ''}
    `;
  }

  window.TriDriver = { getDetails, getRating, render, ratingHtml, firstOf };
})();
