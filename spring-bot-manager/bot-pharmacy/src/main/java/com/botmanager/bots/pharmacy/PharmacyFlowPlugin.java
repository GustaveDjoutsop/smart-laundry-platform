package com.botmanager.bots.pharmacy;

import com.botmanager.bots.pharmacy.persistence.PharmacyProduct;
import com.botmanager.bots.pharmacy.persistence.PharmacyReservation;
import com.botmanager.core.flow.FlowContext;
import com.botmanager.core.flow.FlowPlugin;
import com.botmanager.core.payment.PaymentGateway;
import com.botmanager.core.payment.PaymentRequest;
import com.botmanager.core.payment.PaymentResult;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Slf4j
@RequiredArgsConstructor
public class PharmacyFlowPlugin extends FlowPlugin {

    private final PaymentGateway paymentGateway;

    private final InventoryService inventoryService;

    private final PharmacyBotConfig pharmacyConfig;

    @Override
    public void handleAction(String action, Map<String, Object> params, FlowContext context) {
        log.debug("PharmacyFlowPlugin handling action: {}", action);

        switch (action) {
            case "menu.show" -> handleShowMenu(context);
            case "menu.process" -> handleProcessMenuChoice(context);

            case "products.search" -> handleSearchProducts(context);
            case "products.showResults" -> handleShowSearchResults(context);
            case "products.showAll" -> handleShowAllProducts(context);
            case "products.processSelection" -> handleProcessProductSelection(context);

            case "quantity.show" -> handleShowQuantityPrompt(context);
            case "quantity.process" -> handleProcessQuantity(context);

            case "reservation.confirm" -> handleConfirmReservation(context);
            case "reservation.showActive" -> handleShowActiveReservations(context);
            case "reservation.cancel" -> handleCancelReservation(context);

            case "payment.initiate" -> handleInitiatePayment(context);

            default -> log.warn("Unknown pharmacy action: {}", action);
        }
    }

    private void handleShowMenu(FlowContext context) {
        String pharmacyName = pharmacyConfig.getPharmacyName();
        context.set("pharmacyName", pharmacyName != null ? pharmacyName : "Pharmacy");
        goTo(context, "menu_buttons");
    }

    private void handleProcessMenuChoice(FlowContext context) {
        String choice = context.getString("userInput");

        switch (choice) {
            case "1", "search" -> goTo(context, "search_prompt");
            case "2", "browse" -> goTo(context, "browse_products");
            case "3", "reservations" -> goTo(context, "show_reservations");
            default -> {
                context.set("errorMessage", "Please select a valid option (1-3).");
                goTo(context, "menu_buttons");
            }
        }
    }

    private void handleSearchProducts(FlowContext context) {
        String query = context.getString("userInput");

        if (query == null || query.isBlank()) {
            context.set("errorMessage", "Please enter a product name to search.");
            goTo(context, "search_prompt");
            return;
        }

        List<PharmacyProduct> results = inventoryService.searchProducts(query);
        context.set("searchQuery", query);

        if (results.isEmpty()) {
            context.set("noResults", true);
            goTo(context, "no_results");
            return;
        }

        StringBuilder productList = buildProductList(results);
        context.set("productList", productList.toString());
        context.set("productCount", results.size());

        for (int i = 0; i < results.size(); i++) {
            context.set("product_" + (i + 1), results.get(i).getId().toString());
        }

        goTo(context, "show_product_list");
    }

    private void handleShowSearchResults(FlowContext context) {
        goTo(context, "show_product_list");
    }

    private void handleShowAllProducts(FlowContext context) {
        List<PharmacyProduct> products = inventoryService.getAvailableProducts();

        if (products.isEmpty()) {
            context.set("noResults", true);
            goTo(context, "no_results");
            return;
        }

        StringBuilder productList = buildProductList(products);
        context.set("productList", productList.toString());
        context.set("productCount", products.size());

        for (int i = 0; i < products.size(); i++) {
            context.set("product_" + (i + 1), products.get(i).getId().toString());
        }

        goTo(context, "show_product_list");
    }

    private void handleProcessProductSelection(FlowContext context) {
        String input = context.getString("userInput");
        int index;
        try {
            index = Integer.parseInt(input);
        } catch (NumberFormatException e) {
            context.set("errorMessage", "Please enter a valid product number.");
            goTo(context, "show_product_list");
            return;
        }

        String productIdStr = getContextString(context, "product_" + index);
        if (productIdStr == null) {
            context.set("errorMessage", "Invalid selection. Please try again.");
            goTo(context, "show_product_list");
            return;
        }

        UUID productId = UUID.fromString(productIdStr);
        Optional<PharmacyProduct> productOpt = inventoryService.getProduct(productId);
        if (productOpt.isEmpty()) {
            context.set("errorMessage", "Product not found.");
            goTo(context, "show_product_list");
            return;
        }

        PharmacyProduct product = productOpt.get();
        context.set("selectedProductId", product.getId().toString());
        context.set("selectedProductName", product.getName());
        context.set("selectedProductPrice", product.getPrice().toPlainString());
        context.set("selectedProductStock", product.getStock());
        context.set("currency", pharmacyConfig.getCurrency());

        goTo(context, "quantity_prompt");
    }

    private void handleShowQuantityPrompt(FlowContext context) {
        goTo(context, "quantity_prompt");
    }

    private void handleProcessQuantity(FlowContext context) {
        String input = context.getString("userInput");
        int quantity;
        try {
            quantity = Integer.parseInt(input);
        } catch (NumberFormatException e) {
            context.set("errorMessage", "Please enter a valid number.");
            goTo(context, "quantity_prompt");
            return;
        }

        if (quantity <= 0) {
            context.set("errorMessage", "Quantity must be at least 1.");
            goTo(context, "quantity_prompt");
            return;
        }

        Object stockObj = getContext(context, "selectedProductStock");
        int stock = stockObj instanceof Number n ? n.intValue() : 0;
        if (quantity > stock) {
            context.set("errorMessage", "Only " + stock + " units available.");
            goTo(context, "quantity_prompt");
            return;
        }

        context.set("quantity", quantity);

        String priceStr = getContextString(context, "selectedProductPrice");
        BigDecimal unitPrice = new BigDecimal(priceStr);
        BigDecimal totalPrice = unitPrice.multiply(BigDecimal.valueOf(quantity));
        context.set("totalPrice", totalPrice.toPlainString());

        goTo(context, "confirm_order");
    }

    private void handleConfirmReservation(FlowContext context) {
        String input = context.getString("userInput");

        if ("1".equals(input) || "yes".equalsIgnoreCase(input)) {
            String productIdStr = getContextString(context, "selectedProductId");
            String customerPhone = getContextString(context, "customerPhone");
            Object quantityObj = getContext(context, "quantity");
            int quantity = quantityObj instanceof Number n ? n.intValue() : 1;

            UUID productId = UUID.fromString(productIdStr);
            Optional<PharmacyReservation> reservationOpt =
                    inventoryService.reserveProduct(productId, customerPhone, quantity);

            if (reservationOpt.isPresent()) {
                PharmacyReservation reservation = reservationOpt.get();
                context.set("reservationId", reservation.getId().toString());
                goTo(context, "reservation_success");
            } else {
                context.set("errorMessage", "Unable to reserve. The product may be out of stock.");
                goTo(context, "menu_buttons");
            }
        } else {
            goTo(context, "menu_buttons");
        }
    }

    private void handleShowActiveReservations(FlowContext context) {
        String customerPhone = getContextString(context, "customerPhone");
        List<PharmacyReservation> reservations = inventoryService.getActiveReservations(customerPhone);

        if (reservations.isEmpty()) {
            context.set("noReservations", true);
            goTo(context, "no_reservations");
            return;
        }

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < reservations.size(); i++) {
            PharmacyReservation r = reservations.get(i);
            sb.append(i + 1).append(". ")
                    .append(r.getProduct().getName())
                    .append(" x").append(r.getQuantity())
                    .append(" - ").append(r.getStatus())
                    .append("\n");
            context.set("reservation_" + (i + 1), r.getId().toString());
        }
        context.set("reservationList", sb.toString());
        context.set("reservationCount", reservations.size());

        goTo(context, "show_reservations_list");
    }

    private void handleCancelReservation(FlowContext context) {
        String input = context.getString("userInput");
        int index;
        try {
            index = Integer.parseInt(input);
        } catch (NumberFormatException e) {
            context.set("errorMessage", "Please enter a valid reservation number.");
            goTo(context, "show_reservations_list");
            return;
        }

        String reservationIdStr = getContextString(context, "reservation_" + index);
        if (reservationIdStr == null) {
            context.set("errorMessage", "Invalid selection.");
            goTo(context, "show_reservations_list");
            return;
        }

        UUID reservationId = UUID.fromString(reservationIdStr);
        if (inventoryService.cancelReservation(reservationId)) {
            context.set("cancelSuccess", true);
        } else {
            context.set("errorMessage", "Could not cancel reservation.");
        }
        goTo(context, "menu_buttons");
    }

    private void handleInitiatePayment(FlowContext context) {
        String customerPhone = getContextString(context, "customerPhone");
        String totalPriceStr = getContextString(context, "totalPrice");
        String productName = getContextString(context, "selectedProductName");

        PaymentRequest request = PaymentRequest.builder()
                .amount(Integer.parseInt(totalPriceStr))
                .currency(pharmacyConfig.getCurrency())
                .phoneNumber(customerPhone)
                .description("Pharmacy: " + productName)
                .build();

        PaymentResult result = paymentGateway.initiatePayment(request);

        if (result.success()) {
            context.set("paymentRef", result.transactionId());
            goTo(context, "payment_pending");
        } else {
            context.set("errorMessage", "Payment failed. Please try again.");
            goTo(context, "menu_buttons");
        }
    }

    private StringBuilder buildProductList(List<PharmacyProduct> products) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < products.size(); i++) {
            PharmacyProduct p = products.get(i);
            sb.append(i + 1).append(". ")
                    .append(p.getName())
                    .append(" - ").append(p.getPrice().toPlainString())
                    .append(" ").append(pharmacyConfig.getCurrency())
                    .append(" (").append(p.getStock()).append(" in stock)")
                    .append("\n");
        }
        return sb;
    }

}
