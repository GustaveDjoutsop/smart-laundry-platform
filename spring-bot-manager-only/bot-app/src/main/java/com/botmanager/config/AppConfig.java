package com.botmanager.config;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.PropertyNamingStrategies;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.client.ClientHttpRequestInterceptor;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.util.List;
import java.util.concurrent.Executor;

@Slf4j
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties({
        WhatsAppProperties.class,
        CamPayProperties.class,
        PaymentProperties.class,
        RateLimitProperties.class,
        BotProperties.class,
        MicroserviceProperties.class
})
public class AppConfig {

    @Value("${microservice.http.user-agent:SpringBot/1.0}")
    private String httpUserAgent;

    @Bean
    ObjectMapper objectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);

        return mapper;
    }

    @Bean
    ObjectMapper snakeCaseObjectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.registerModule(new JavaTimeModule());
        mapper.configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false);
        mapper.setPropertyNamingStrategy(PropertyNamingStrategies.SNAKE_CASE);

        return mapper;
    }

    @Bean
    RestTemplate restTemplate() {
        RestTemplate restTemplate = new RestTemplate();
        ClientHttpRequestInterceptor userAgentInterceptor = (request, body, execution) -> {
            request.getHeaders().set(HttpHeaders.USER_AGENT, httpUserAgent);
            return execution.execute(request, body);
        };
        restTemplate.setInterceptors(List.of(userAgentInterceptor));
        return restTemplate;
    }

    /**
     * Fail-closed fallback used when the Auth0 M2M client (smartlaundry-m2m) is not
     * configured. Every call through this client errors immediately instead of being
     * sent to PaymentManagementService/MachineStateService without an Authorization
     * header — those services now require a Bearer token, so an unauthenticated
     * request would either be silently rejected or, worse, succeed against an
     * endpoint that isn't yet locked down.
     */
    @Bean("microserviceWebClient")
    @ConditionalOnExpression("'${spring.security.oauth2.client.registration.smartlaundry-m2m.client-secret:}' == ''")
    WebClient microserviceWebClientFallback() {
        log.error("Auth0 M2M client 'smartlaundry-m2m' is not configured (missing client-secret) — "
                + "inter-service calls to PaymentManagementService/MachineStateService will fail closed.");
        return WebClient.builder()
                .filter((request, next) -> Mono.error(new IllegalStateException(
                        "Refusing unauthenticated call to " + request.url()
                                + " — configure spring.security.oauth2.client.registration.smartlaundry-m2m.client-secret")))
                .build();
    }

    @Bean(name = "webhookExecutor")
    Executor webhookExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(2);
        executor.setMaxPoolSize(4);
        executor.setQueueCapacity(500);
        executor.setThreadNamePrefix("webhook-");
        executor.setRejectedExecutionHandler(new java.util.concurrent.ThreadPoolExecutor.CallerRunsPolicy());
        executor.initialize();

        return executor;
    }

}
