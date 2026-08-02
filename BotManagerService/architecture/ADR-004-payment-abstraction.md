# ADR-004: Payment Gateway Abstraction Layer

## Status
**Accepted** - January 2026

## Context

The Cameroonian market requires multiple payment providers:
- **MTN Mobile Money:** 70% market share
- **Orange Money:** 25% market share  
- **CamPay:** Aggregator (handles both + cards)
- **Wave:** Growing, popular with youth
- **Nkwa:** Local B2B solution

Each provider has different:
- API formats (REST, SOAP)
- Authentication (OAuth, API keys, signatures)
- Webhooks (different payloads)
- Transaction states

## Decision

Implement a **Payment Gateway Abstraction** that provides a unified interface:

### Interface Design
```javascript
// All providers implement this interface
class PaymentProvider {
  // Initiate payment request to customer's phone
  async initiatePayment(options) {
    // options: { amount, currency, phoneNumber, reference, description }
    // returns: { transactionId, status, externalRef }
  }
  
  // Check payment status
  async checkStatus(transactionId) {
    // returns: { status, amount, completedAt }
  }
  
  // Verify webhook signature
  verifyWebhook(payload, signature) {
    // returns: boolean
  }
  
  // Parse webhook to standard format
  parseWebhook(payload) {
    // returns: { transactionId, status, amount, externalRef }
  }
}
```

### Unified Status Mapping
```javascript
const StatusMap = {
  // CamPay
  'SUCCESSFUL': 'COMPLETED',
  'PENDING': 'PENDING',
  'FAILED': 'FAILED',
  
  // MTN MoMo  
  'SUCCESSFUL': 'COMPLETED',
  'PENDING': 'PENDING',
  'FAILED': 'FAILED',
  
  // Nkwa
  'completed': 'COMPLETED',
  'processing': 'PENDING',
  'failed': 'FAILED'
};
```

### Provider Selection Strategy
```javascript
class PaymentGateway {
  selectProvider(options) {
    const { phoneNumber, amount, preferredProvider } = options;
    
    // 1. Use preferred if specified and available
    if (preferredProvider && this.isAvailable(preferredProvider)) {
      return preferredProvider;
    }
    
    // 2. Detect carrier from phone prefix
    const carrier = this.detectCarrier(phoneNumber);
    if (carrier === 'mtn' && this.isAvailable('mtn')) return 'mtn';
    if (carrier === 'orange' && this.isAvailable('orange')) return 'orange';
    
    // 3. Fallback to aggregator
    return 'campay';
  }
  
  detectCarrier(phone) {
    // Cameroon prefixes
    const mtnPrefixes = ['67', '68', '65', '66'];
    const orangePrefixes = ['69', '655', '656'];
    
    const prefix = phone.replace('+237', '').substring(0, 2);
    if (mtnPrefixes.includes(prefix)) return 'mtn';
    if (orangePrefixes.includes(prefix)) return 'orange';
    return 'unknown';
  }
}
```

### Retry & Fallback
```javascript
async processPayment(options) {
  const providers = ['campay', 'mtn', 'nkwa'];
  
  for (const providerName of providers) {
    try {
      const provider = this.getProvider(providerName);
      return await provider.initiatePayment(options);
    } catch (error) {
      this.logger.warn(`Provider ${providerName} failed`, error);
      // Try next provider
    }
  }
  
  throw new PaymentError('All providers failed');
}
```

## Consequences

### Positive
- **Provider agnostic:** Switch providers without code changes
- **Redundancy:** Automatic fallback on failure
- **Testing:** Mock providers for testing
- **Metrics:** Unified tracking across providers

### Negative
- **Abstraction cost:** Some provider features hidden
- **Mapping complexity:** Edge cases in status mapping
- **Webhook routing:** Must identify provider from webhook

### Provider-Specific Features Lost
| Provider | Lost Feature | Workaround |
|----------|--------------|------------|
| MTN | Balance check | Separate admin API |
| CamPay | Card payments | Add later if needed |
| Wave | Checkout URL | Redirect flow variant |

## Implementation Status

| Provider | Status | Notes |
|----------|--------|-------|
| CamPay | ✅ Implemented | Primary for MVP |
| MTN MoMo | ✅ Implemented | Sandbox tested |
| Orange Money | 🔲 Planned | Phase 2 |
| Wave | 🔲 Planned | Phase 2 |
| Nkwa | 🔲 Planned | Phase 2 |

## References
- [Strategy Pattern](https://refactoring.guru/design-patterns/strategy)
- [Payment API Guide](/mnt/project/guide_api_paiement.md)
