package com.botmanager.config;

import lombok.extern.slf4j.Slf4j;
import org.slf4j.MDC;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.RequestEntity;
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
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.StringUtils;
import org.springframework.util.MultiValueMap;
import org.springframework.web.reactive.function.client.ClientRequest;
import org.springframework.web.reactive.function.client.WebClient;
import io.netty.channel.ChannelOption;
import reactor.netty.http.client.HttpClient;

import java.net.URI;
import java.time.Duration;
import java.util.List;

/**
 * Configures a WebClient that automatically attaches Auth0 client-credentials
 * Bearer tokens to all outbound calls to payment-management-service and machine-state-service.
 *
 * Activated only when an OAuth2 client registration named "smartlaundry-m2m" is present
 * (configured via spring.security.oauth2.client.registration.smartlaundry-m2m or env vars).
 */
@Slf4j
@Configuration(proxyBeanMethods = false)
@ConditionalOnExpression("'${spring.security.oauth2.client.registration.smartlaundry-m2m.client-secret:}' != ''")
public class MicroserviceClientConfig {

    private static final Authentication SYSTEM_PRINCIPAL = new AnonymousAuthenticationToken(
            "system", "system", List.of(new SimpleGrantedAuthority("ROLE_SYSTEM")));

    @Value("${microservice.oauth2-registration-id:smartlaundry-m2m}")
    private String registrationId;

    @Value("${auth0.audience:https://smartlaundry.api}")
    private String audience;

    @Bean
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

    @Bean("microserviceWebClient")
    public WebClient microserviceWebClient(OAuth2AuthorizedClientManager microserviceAuthorizedClientManager) {
        log.info("Microservice WebClient configured with OAuth2 client credentials ({})", registrationId);
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 5_000)
                .responseTimeout(Duration.ofSeconds(10));
        return WebClient.builder()
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .defaultHeader(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .defaultHeader(HttpHeaders.ACCEPT, MediaType.APPLICATION_JSON_VALUE)
                .filter((request, next) -> {
                    // Forward the current request's correlation ID (see CorrelationIdFilter) downstream.
                    String correlationId = MDC.get(CorrelationIdFilter.MDC_KEY);
                    if (correlationId != null) {
                        ClientRequest withCorrelationId = ClientRequest.from(request)
                                .header(CorrelationIdFilter.HEADER, correlationId)
                                .build();
                        return next.exchange(withCorrelationId);
                    }
                    return next.exchange(request);
                })
                .filter((request, next) -> {
                    try {
                        OAuth2AuthorizeRequest authorizeRequest = OAuth2AuthorizeRequest
                                .withClientRegistrationId(registrationId)
                                .principal(SYSTEM_PRINCIPAL)
                                .build();
                        OAuth2AuthorizedClient client = microserviceAuthorizedClientManager.authorize(authorizeRequest);
                        if (client != null) {
                            ClientRequest authorized = ClientRequest.from(request)
                                    .headers(h -> h.setBearerAuth(client.getAccessToken().getTokenValue()))
                                    .build();
                            return next.exchange(authorized);
                        }
                    } catch (Exception e) {
                        log.warn("Could not obtain OAuth2 access token for {}: {}", request.url(), e.getMessage());
                    }
                    return next.exchange(request);
                })
                .build();
    }
}
