package com.smartlaundromat.payment.config;

import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.RequestEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.oauth2.client.AuthorizedClientServiceOAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.OAuth2AuthorizeRequest;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClient;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientManager;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientProviderBuilder;
import org.springframework.security.oauth2.client.OAuth2AuthorizedClientService;
import org.springframework.security.oauth2.client.endpoint.DefaultClientCredentialsTokenResponseClient;
import org.springframework.security.oauth2.client.registration.ClientRegistration;
import org.springframework.security.oauth2.client.registration.ClientRegistrationRepository;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;

import java.net.URI;
import java.util.List;

/**
 * Configures the RestTemplate used by {@code MachineStartService} to call
 * MachineStateService's {@code /api/machines/start-cycle}. Attaches an Auth0
 * client-credentials Bearer token (registration {@code smartlaundry-m2m}),
 * mirroring spring-bot-manager-only's MicroserviceClientConfig.
 *
 * When the M2M client isn't configured (no client-secret), every call fails
 * closed instead of being sent to MachineStateService unauthenticated.
 */
@Slf4j
@Configuration(proxyBeanMethods = false)
public class MicroserviceClientConfig {

    private static final Authentication SYSTEM_PRINCIPAL = new AnonymousAuthenticationToken(
            "system", "system", List.of(new SimpleGrantedAuthority("ROLE_SYSTEM")));

    /** Forwards the current request's correlation ID (see {@link CorrelationIdFilter}) downstream. */
    private static final org.springframework.http.client.ClientHttpRequestInterceptor CORRELATION_ID_INTERCEPTOR =
            (request, body, execution) -> {
                String correlationId = MDC.get(CorrelationIdFilter.MDC_KEY);
                if (correlationId != null) {
                    request.getHeaders().set(CorrelationIdFilter.HEADER, correlationId);
                }
                return execution.execute(request, body);
            };

    @Value("${microservice.oauth2-registration-id:smartlaundry-m2m}")
    private String registrationId;

    @Value("${auth0.audience:https://smartlaundry.api}")
    private String audience;

    @Bean
    @ConditionalOnExpression("'${spring.security.oauth2.client.registration.smartlaundry-m2m.client-secret:}' != ''")
    public OAuth2AuthorizedClientManager microserviceAuthorizedClientManager(
            ClientRegistrationRepository clients,
            OAuth2AuthorizedClientService service) {

        DefaultClientCredentialsTokenResponseClient tokenResponseClient =
                new DefaultClientCredentialsTokenResponseClient();

        // Auth0 requires an `audience` parameter that Spring Security doesn't send by default.
        tokenResponseClient.setRequestEntityConverter(grantRequest -> {
            ClientRegistration reg = grantRequest.getClientRegistration();
            MultiValueMap<String, String> params = new LinkedMultiValueMap<>();
            params.set("grant_type", "client_credentials");
            params.set("client_id", reg.getClientId());
            params.set("client_secret", reg.getClientSecret());
            if (!reg.getScopes().isEmpty()) {
                params.set("scope", String.join(" ", reg.getScopes()));
            }
            if (StringUtils.hasText(audience)) {
                params.set("audience", audience);
            }

            org.springframework.http.HttpHeaders httpHeaders = new org.springframework.http.HttpHeaders();
            httpHeaders.setContentType(MediaType.APPLICATION_FORM_URLENCODED);

            return new RequestEntity<>(params, httpHeaders, HttpMethod.POST,
                    URI.create(reg.getProviderDetails().getTokenUri()));
        });

        AuthorizedClientServiceOAuth2AuthorizedClientManager manager =
                new AuthorizedClientServiceOAuth2AuthorizedClientManager(clients, service);
        manager.setAuthorizedClientProvider(
                OAuth2AuthorizedClientProviderBuilder.builder()
                        .clientCredentials(b -> b.accessTokenResponseClient(tokenResponseClient))
                        .build());
        return manager;
    }

    @Bean("machineStateRestTemplate")
    @ConditionalOnExpression("'${spring.security.oauth2.client.registration.smartlaundry-m2m.client-secret:}' != ''")
    public RestTemplate machineStateRestTemplate(OAuth2AuthorizedClientManager microserviceAuthorizedClientManager) {
        log.info("MachineStateService RestTemplate configured with OAuth2 client credentials ({})", registrationId);

        RestTemplate restTemplate = new RestTemplate(httpRequestFactory());
        restTemplate.getInterceptors().add(CORRELATION_ID_INTERCEPTOR);
        restTemplate.getInterceptors().add((request, body, execution) -> {
            OAuth2AuthorizeRequest authorizeRequest = OAuth2AuthorizeRequest
                    .withClientRegistrationId(registrationId)
                    .principal(SYSTEM_PRINCIPAL)
                    .build();
            OAuth2AuthorizedClient client = microserviceAuthorizedClientManager.authorize(authorizeRequest);
            if (client == null) {
                throw new IllegalStateException(
                        "Unable to obtain Auth0 M2M token for registration '" + registrationId + "'");
            }
            request.getHeaders().setBearerAuth(client.getAccessToken().getTokenValue());
            return execution.execute(request, body);
        });
        return restTemplate;
    }

    /**
     * Fail-closed fallback: if the M2M client isn't configured, refuse to call
     * MachineStateService unauthenticated. {@code MachineStartService} already
     * wraps its call in a try/catch and logs+skips on failure.
     */
    @Bean("machineStateRestTemplate")
    @ConditionalOnExpression("'${spring.security.oauth2.client.registration.smartlaundry-m2m.client-secret:}' == ''")
    public RestTemplate machineStateRestTemplateFallback() {
        log.warn("Auth0 M2M client 'smartlaundry-m2m' is not configured (missing client-secret) — "
                + "calls to MachineStateService will fail closed.");
        RestTemplate restTemplate = new RestTemplate(httpRequestFactory());
        restTemplate.getInterceptors().add((request, body, execution) -> {
            throw new RestClientException(
                    "Refusing unauthenticated call to " + request.getURI()
                            + " — configure spring.security.oauth2.client.registration.smartlaundry-m2m.client-secret");
        });
        return restTemplate;
    }

    private SimpleClientHttpRequestFactory httpRequestFactory() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5_000);
        factory.setReadTimeout(10_000);
        return factory;
    }
}
