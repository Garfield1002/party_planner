/**
 * Party Planner — Frontend Application
 *
 * Flow:
 *   1. Wait for DOMContentLoaded
 *   2. Extract ?token=<UUIDv4> from the URL
 *   3. Fetch invitation data from the Apps Script backend
 *   4. Render the invitation
 *   5. Submit RSVP back to the backend
 */

// ============================================================
// Configuration — injected at deploy time via GitHub Actions
// ============================================================

var CONFIG = {
  API_BASE_URL: '__API_BASE_URL__'
};

var UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

// Correct UUIDv4 regex: 8-4-4-4-12
UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ============================================================
// Init
// ============================================================

document.addEventListener('DOMContentLoaded', function () {
  bindForm();

  var token = getTokenFromURL();

  console.debug('location.href:', window.location.href);
  console.debug('token:', token);
  console.debug('isUuidV4:', isUuidV4(token));
  console.debug('API_BASE_URL:', CONFIG.API_BASE_URL);

  if (!isUuidV4(token)) {
    showError('Missing or invalid invitation token. Please use the link from your invitation.');
    return;
  }

  showState('loading');
  fetchInvite(token);
});

// ============================================================
// Fetch & Render
// ============================================================

async function fetchInvite(token) {
  try {
    var url = CONFIG.API_BASE_URL
      + '?action=get_invite'
      + '&token=' + encodeURIComponent(token)
      + '&_=' + encodeURIComponent(String(Date.now()));

    console.debug('GET invite URL:', url);

    var response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      credentials: 'omit'
    });

    console.debug('GET response status:', response.status);
    console.debug('GET response URL:', response.url);

    if (!response.ok) {
      showError('Could not connect to the server. Please try again later.');
      return;
    }

    var text = await response.text();
    console.debug('GET raw response:', text);

    var data = parseJson(text);

    if (!data) {
      showError('Received an unexpected response. Please try again.');
      return;
    }

    if (!data.success) {
      showError(data.error || 'Invalid invitation link.');
      return;
    }

    renderInvitation(data);
    showState('invitation');
  } catch (err) {
    console.error('fetchInvite failed:', err);
    showError('Could not connect to the server. Please check your internet connection and try again.');
  }
}

function renderInvitation(data) {
  var guest = data.guest || {};
  var event = data.event || {};
  var existing = data.existing_rsvp || null;

  var img = document.getElementById('invite-image');

  if (img) {
    if (data.invitation_png_b64) {
      img.src = 'data:image/png;base64,' + data.invitation_png_b64;
      img.alt = 'Party Invitation';
      img.style.display = '';
    } else {
      img.removeAttribute('src');
      img.style.display = 'none';
      console.warn(
        'Invitation image not available. Possible causes:\n' +
        '  1. "invitation_drive_id" is missing or incorrect in the Event sheet\n' +
        '  2. The Drive file is not shared with "Anyone with the link"\n' +
        '  3. The Drive file is not a PNG image\n' +
        '  4. The Apps Script deployment needs to be updated'
      );
    }
  }

  setText('guest-name', guest.name || '');

  if (guest.plus_invitation) {
    showEl('plus-one', 'block');
    setText('plus-one-name', guest.plus_invitation);
  } else {
    showEl('plus-one', 'none');
    setText('plus-one-name', '');
  }

  setText('event-name', event.event_name || '');
  setText('event-date', event.date || '');
  setText('event-time', event.time || '');
  setText('event-address', event.address || '');
  setText('event-phone', event.phone || '');

  if (event.message) {
    setText('event-message', event.message);
    showEl('event-message', 'block');
  } else {
    setText('event-message', '');
    showEl('event-message', 'none');
  }

  if (existing) {
    prefillForm(existing);
  }
}

// ============================================================
// RSVP Form Handling
// ============================================================

function prefillForm(rsvp) {
  var attending = String(rsvp.attending || '').trim().toLowerCase();

  if (attending === 'yes' || attending === 'no') {
    var radio = document.querySelector('input[name="attending"][value="' + attending + '"]');

    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change'));
    }
  }

  if (attending === 'yes') {
    var select = document.querySelector('select[name="meal_preference"]');

    if (select && rsvp.meal_preference) {
      select.value = String(rsvp.meal_preference);
    }
  }

  var dietary = document.querySelector('textarea[name="dietary_restrictions"]');
  if (dietary) {
    dietary.value = String(rsvp.dietary_restrictions || '');
  }

  var notes = document.querySelector('textarea[name="notes"]');
  if (notes) {
    notes.value = String(rsvp.notes || '');
  }
}

function bindForm() {
  var form = document.getElementById('rsvp-form');

  if (!form) {
    return;
  }

  var radios = form.querySelectorAll('input[name="attending"]');

  radios.forEach(function (radio) {
    radio.addEventListener('change', function () {
      var isDeclining = this.value === 'no';

      showEl('meal-section', isDeclining ? 'none' : 'block');
      showEl('dietary-section', isDeclining ? 'none' : 'block');
      showEl('notes-section', 'block');
    });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    submitRsvp();
  });
}

async function submitRsvp() {
  try {
    var token = getTokenFromURL();

    if (!isUuidV4(token)) {
      alert('Invalid invitation token.');
      return;
    }

    var attending = document.querySelector('input[name="attending"]:checked');
    var meal = document.querySelector('select[name="meal_preference"]');
    var dietary = document.querySelector('textarea[name="dietary_restrictions"]');
    var notes = document.querySelector('textarea[name="notes"]');

    var attendingValue = attending ? attending.value : '';

    if (attendingValue !== 'yes' && attendingValue !== 'no') {
      alert('Please choose whether you are attending.');
      return;
    }

    var mealValue = meal ? meal.value : '';
    var dietaryValue = dietary ? dietary.value : '';
    var notesValue = notes ? notes.value : '';

    if (attendingValue === 'no') {
      mealValue = '';
      dietaryValue = '';
    }

    var payload = {
      action: 'submit_rsvp',
      token: token,
      attending: attendingValue,
      meal_preference: mealValue,
      dietary_restrictions: dietaryValue,
      notes: notesValue
    };

    var submitBtn = document.querySelector('.btn-primary');
    setSubmitButtonState(submitBtn, true);

    var body = new URLSearchParams();
    body.set('payload', JSON.stringify(payload));

    console.debug('POST RSVP URL:', CONFIG.API_BASE_URL);
    console.debug('POST RSVP payload:', payload);

    var response = await fetch(CONFIG.API_BASE_URL, {
      method: 'POST',
      redirect: 'follow',
      credentials: 'omit',
      body: body
    });

    console.debug('POST response status:', response.status);
    console.debug('POST response URL:', response.url);

    if (!response.ok) {
      alert('Could not submit RSVP. Please try again.');
      setSubmitButtonState(submitBtn, false);
      return;
    }

    var text = await response.text();
    console.debug('POST raw response:', text);

    var result = parseJson(text);

    if (!result) {
      alert('Unexpected response. Please try again.');
      setSubmitButtonState(submitBtn, false);
      return;
    }

    if (result.success) {
      showConfirmation(attendingValue);
    } else {
      alert('Error: ' + (result.error || 'Could not submit RSVP.'));
      setSubmitButtonState(submitBtn, false);
    }
  } catch (err) {
    console.error('submitRsvp failed:', err);
    alert('Could not connect to the server. Please try again.');

    var submitBtn = document.querySelector('.btn-primary');
    setSubmitButtonState(submitBtn, false);
  }
}

function showConfirmation(attending) {
  var form = document.getElementById('rsvp-form');

  if (form) {
    form.style.display = 'none';
  }

  var confirmBox = document.getElementById('confirmation');
  var confirmText = document.getElementById('confirmation-text');

  if (!confirmBox || !confirmText) {
    return;
  }

  if (attending === 'yes') {
    confirmText.textContent = 'Thank you! We look forward to celebrating with you!';
    confirmBox.style.borderColor = '#66bb6a';
    confirmBox.style.background = '#e8f5e9';
  } else {
    confirmText.textContent = 'Thank you for letting us know. You will be missed!';
    confirmBox.style.borderColor = '#f9a825';
    confirmBox.style.background = '#fff8e1';
  }

  confirmBox.style.display = 'block';
  confirmBox.scrollIntoView({
    behavior: 'smooth',
    block: 'center'
  });
}

// ============================================================
// UI Helpers
// ============================================================

function showState(stateName) {
  var states = ['loading', 'error', 'invitation'];

  states.forEach(function (s) {
    var el = document.getElementById(s);

    if (el) {
      el.style.display = s === stateName ? 'block' : 'none';
    }
  });
}

function showError(message) {
  setErrorMessage(message);
  showState('error');
}

function setErrorMessage(message) {
  setText('error-message', message);
}

function setText(id, value) {
  var el = document.getElementById(id);

  if (el) {
    el.textContent = String(value || '');
  }
}

function showEl(id, displayValue) {
  var el = document.getElementById(id);

  if (el) {
    el.style.display = displayValue;
  }
}

function setSubmitButtonState(button, isSubmitting) {
  if (!button) {
    return;
  }

  button.disabled = isSubmitting;
  button.textContent = isSubmitting ? 'Submitting...' : 'Submit RSVP';
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('JSON parse failed. Raw text:', text);
    return null;
  }
}

// ============================================================
// Token / config helpers
// ============================================================

function getTokenFromURL() {
  var searchParams = new URLSearchParams(window.location.search);
  var token = searchParams.get('token');

  if (token) {
    return token.trim();
  }

  // Supports:
  //   /#token=<uuid>
  //   /#/invite?token=<uuid>
  var hash = window.location.hash || '';

  if (hash.charAt(0) === '#') {
    hash = hash.slice(1);
  }

  var questionMarkIndex = hash.indexOf('?');

  if (questionMarkIndex !== -1) {
    hash = hash.slice(questionMarkIndex + 1);
  }

  var hashParams = new URLSearchParams(hash);
  token = hashParams.get('token');

  return token ? token.trim() : '';
}

function isUuidV4(value) {
  return UUID_V4_RE.test(String(value || '').trim());
}
