package com.smartlaundry.gateway;

import com.github.tomakehurst.wiremock.WireMockServer;
import com.smartlaundry.gateway.filter.CorrelationIdFilter;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.autoconfigure.web.reactive.AutoConfigureWebTestClient;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.reactive.server.WebTestClient;
import reactor.core.publisher.Mono;

import java.time.Instant;
import java.util.List;

import static com.github.tomakehurst.wiremock.client.WireMock.aResponse;
import static com.github.tomakehurst.wiremock.client.WireMock.equalTo;
import static com.github.tomakehurst.wiremock.client.WireMock.get;
import static com.github.tomakehurst.wiremock.client.WireMock.post;
import static com.github.tomakehurst.wiremock.client.WireMock.postRequestedFor;
import static com.github.tomakehurst.wiremock.client.WireMock.urlEqualTo;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

/**
 * Verifies the routing/security/correlation-ID behavior described in
 * architecture-review/05-API-GATEWAY-DESIGN.md, in particular the §9 rollout
 * requirement that the CamPay webhook signature header survives the gateway
 * hop byte-for-byte while the route itself remains unauthenticated.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureWebTestClient(timeout = "10000")
class GatewayRoutingTest {

    private static WireMockServer paymentService;

    @org.springframework.beans.factory.annotation.Autowired
    private WebTestClient webTestClient;

    @MockitoBean
    private ReactiveJwtDecoder jwtDecoder;

    @BeforeAll
    static void startPaymentServiceStub() {
        paymentService = new WireMockServer(com.github.tomakehurst.wiremock.core.WireMockConfiguration.options().dynamicPort());
        paymentService.start();
    }

    @AfterAll
    static void stopPaymentServiceStub() {
        paymentService.stop();
    }

    @DynamicPropertySource
    static void registerPaymentServiceUrl(DynamicPropertyRegistry registry) {
        registry.add("PAYMENT_SERVICE_URL", () -> "http://localhost:" + paymentService.port());
    }

    @Test
    void webhookRouteIsUnauthenticatedAndForwardsSignatureHeaderUnchanged() {
        String signature = "test-hmac-signature-value";
        paymentService.stubFor(post(urlEqualTo("/api/webhook/campay"))
                .withHeader("X-Campay-Signature", equalTo(signature))
                .willReturn(aResponse().withStatus(200).withBody("{\"status\":\"ok\"}")));

        webTestClient.post().uri("/payments/api/webhook/campay")
                .header("X-Campay-Signature", signature)
                .header("Content-Type", "application/json")
                .bodyValue("{\"reference\":\"abc\"}")
                .exchange()
                .expectStatus().isOk();

        paymentService.verify(postRequestedFor(urlEqualTo("/api/webhook/campay"))
                .withHeader("X-Campay-Signature", equalTo(signature)));
    }

    @Test
    void authenticatedRouteRejectsRequestWithoutToken() {
        webTestClient.get().uri("/payments/api/transactions")
                .exchange()
                .expectStatus().isUnauthorized();
    }

    @Test
    void authenticatedRouteForwardsRequestWithValidToken() {
        paymentService.stubFor(get(urlEqualTo("/api/transactions"))
                .willReturn(aResponse().withStatus(200).withBody("[]")));

        Instant now = Instant.now();
        Jwt jwt = Jwt.withTokenValue("valid-token")
                .header("alg", "RS256")
                .claim("aud", List.of("https://smartlaundry.api"))
                .claim("sub", "auth0|test-user")
                .claim("scope", "sls-payment-read")
                .issuedAt(now)
                .expiresAt(now.plusSeconds(60))
                .build();
        when(jwtDecoder.decode(any())).thenReturn(Mono.just(jwt));

        webTestClient.get().uri("/payments/api/transactions")
                .header("Authorization", "Bearer valid-token")
                .exchange()
                .expectStatus().isOk()
                .expectHeader().valueMatches(CorrelationIdFilter.HEADER, ".+");
    }

    @Test
    void responseAlwaysCarriesCorrelationId() {
        String signature = "another-signature";
        paymentService.stubFor(post(urlEqualTo("/api/webhook/campay"))
                .willReturn(aResponse().withStatus(200).withBody("{\"status\":\"ok\"}")));

        webTestClient.post().uri("/payments/api/webhook/campay")
                .header(CorrelationIdFilter.HEADER, "my-correlation-id")
                .header("X-Campay-Signature", signature)
                .header("Content-Type", "application/json")
                .bodyValue("{\"reference\":\"abc\"}")
                .exchange()
                .expectHeader().valueEquals(CorrelationIdFilter.HEADER, "my-correlation-id");
    }
}
