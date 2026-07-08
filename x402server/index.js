#!/usr/bin/env node

import app from "./app.js";

const PORT = process.env.PORT || 3002;

app.listen(PORT, () => {
  console.log(`\n💰 x402 Payment Server (V2)`);
  console.log(`   Port:     ${PORT}`);
  console.log(`   Network:  eip155:84532`);
  console.log(`   Headers:  PAYMENT-REQUIRED, PAYMENT-SIGNATURE, PAYMENT-RESPONSE\n`);
});
