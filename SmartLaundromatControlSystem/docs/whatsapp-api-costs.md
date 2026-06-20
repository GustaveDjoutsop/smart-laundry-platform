# WhatsApp Business API - Analyse des Coûts

## Tarifs pour le Cameroun (Rest of Africa)

| Type de message | Coût par message (USD) |
|-----------------|------------------------|
| **Service** (réponse dans 24h) | **GRATUIT** |
| **Utility** | $0.004 |
| **Marketing** | $0.0225 |
| **Authentication** | $0.004 |

> **Note**: Le Cameroun est classé dans la catégorie "Rest of Africa" par Meta.

---

## Flux typique du bot Smart Laundry

### Parcours utilisateur complet

| Étape | Messages envoyés | Type | Coût |
|-------|------------------|------|------|
| 1. User scanne QR code et envoie message | 0 | - | - |
| 2. Bot: Sélection de langue | 1 | Service | **$0** |
| 3. Bot: Menu principal | 1 | Service | **$0** |
| 4. Bot: Sélection machine | 1 | Service | **$0** |
| 5. Bot: Sélection cycle | 1 | Service | **$0** |
| 6. Bot: Initiation paiement | 1 | Service | **$0** |
| 7. Bot: Confirmation paiement | 1 | Utility | **$0.004** |
| 8. Bot: Cycle terminé | 1 | Utility | **$0.004** |
| 9. Bot: Demande feedback (35 min après) | 2 | Utility | **$0.008** |
| 10. Bot: Merci feedback | 1 | Service | **$0** |

---

## Coût par transaction

| Scénario | Coût estimé (USD) | Coût estimé (FCFA) |
|----------|-------------------|---------------------|
| **Transaction normale** (confirmation + fin cycle + feedback) | ~$0.016 | ~10 FCFA |
| **Transaction avec commentaire** (note basse + alerte staff) | ~$0.020 | ~12 FCFA |
| **Transaction annulée** (pas de paiement) | $0 | 0 FCFA |

---

## Estimation mensuelle

| Volume mensuel | Coût/mois (USD) | Coût/mois (FCFA) |
|----------------|-----------------|-------------------|
| 100 transactions | ~$1.60 | ~1,000 FCFA |
| 500 transactions | ~$8.00 | ~5,000 FCFA |
| 1,000 transactions | ~$16.00 | ~10,000 FCFA |
| 2,000 transactions | ~$32.00 | ~20,000 FCFA |

---

## Points clés

### Messages gratuits (Service)
Toutes les réponses envoyées **dans les 24h** après un message client sont **GRATUITES**.

Cela inclut :
- Sélection de langue
- Menu principal
- Sélection de machine
- Sélection de cycle
- Message d'initiation de paiement
- Réponses aux questions

### Messages payants (Utility)
Seuls les messages initiés par le business **après 24h** ou les notifications sont facturés :
- ✅ Confirmation de paiement
- ✅ Notification fin de cycle
- ✅ Demande de feedback
- ✅ Alerte staff (note basse)

### Messages non utilisés
- ❌ **Marketing** : Le bot n'envoie pas de messages marketing (promotions, publicités)
- ❌ **Authentication** : Pas d'OTP ou codes de vérification

---

## Comparaison avec SMS

| Canal | Coût par message | Coût pour 500 transactions |
|-------|------------------|---------------------------|
| **WhatsApp API** | ~$0.016/transaction | ~$8/mois |
| **SMS Cameroun** | ~$0.03-0.05/SMS | ~$45-75/mois |

**Économie avec WhatsApp** : 5-9x moins cher que les SMS traditionnels.

---

## Sources

- [WhatsApp Business Platform Pricing](https://business.whatsapp.com/products/platform-pricing)
- [WhatsApp Business API Pricing 2026 Guide](https://flowcall.co/blog/whatsapp-business-api-pricing-2026)
- [Respond.io - WhatsApp API Pricing 2025](https://respond.io/blog/whatsapp-business-api-pricing)

---

*Document généré le: Janvier 2026*
*Taux de change approximatif: 1 USD ≈ 620 FCFA*
