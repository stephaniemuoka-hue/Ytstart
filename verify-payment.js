// api/verify-payment.js
//
// This runs on the SERVER (Vercel), never in the customer's browser.
// It is the only piece of this system that touches your Paystack
// SECRET key, and that key is never written in this file, it's read
// from an environment variable you set directly in Vercel's dashboard.
//
// What it does:
//   1. Receives a payment reference from the sales page.
//   2. Asks Paystack directly (server-to-server) whether that
//      reference corresponds to a real, successful payment.
//   3. Checks the amount and currency actually match what the course
//      costs, so a reference from an unrelated/smaller payment can't
//      be reused to get access.
//   4. Only then reports back "verified: true".
//
// A browser can lie about anything it sends. Paystack's own servers
// cannot be lied to about whether a payment really happened, that's
// why this check has to happen here, not in the sales page's JS.

const EXPECTED_AMOUNT_KOBO = 1000000; // ₦10,000, Paystack amounts are in kobo
const EXPECTED_CURRENCY = 'NGN';

export default async function handler(req, res) {
  // Allow the sales page to call this from the browser.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ verified: false, error: 'Method not allowed' });
  }

  const { reference } = req.body || {};
  if (!reference || typeof reference !== 'string') {
    return res.status(400).json({ verified: false, error: 'Missing payment reference' });
  }

  const secretKey = process.env.PAYSTACK_SECRET_KEY;
  if (!secretKey) {
    // This means the environment variable hasn't been set in Vercel yet.
    console.error('PAYSTACK_SECRET_KEY is not set in this deployment.');
    return res.status(500).json({ verified: false, error: 'Server is not configured yet' });
  }

  try {
    const paystackRes = await fetch(
      'https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference),
      { headers: { Authorization: 'Bearer ' + secretKey } }
    );
    const result = await paystackRes.json();

    if (!result || !result.status || !result.data) {
      return res.status(200).json({ verified: false, error: 'Paystack could not find this transaction' });
    }

    const tx = result.data;
    const paidSuccessfully = tx.status === 'success';
    const correctAmount = tx.amount === EXPECTED_AMOUNT_KOBO;
    const correctCurrency = tx.currency === EXPECTED_CURRENCY;

    if (paidSuccessfully && correctAmount && correctCurrency) {
      return res.status(200).json({
        verified: true,
        email: (tx.customer && tx.customer.email) || null
      });
    }

    return res.status(200).json({
      verified: false,
      error: 'Payment did not match the expected amount, currency, or was not successful'
    });

  } catch (err) {
    console.error('Verification request to Paystack failed:', err);
    return res.status(500).json({ verified: false, error: 'Could not reach Paystack to verify this payment' });
  }
}
