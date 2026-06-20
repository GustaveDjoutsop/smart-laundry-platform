package com.smartlaundromat.reporting.config;

import org.springframework.core.MethodParameter;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.mvc.method.annotation.ResponseBodyAdvice;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Converts all Map<String,Object> keys returned by controllers from snake_case
 * (as produced by JDBC column names) to camelCase before Jackson serialization.
 * Applies recursively to nested maps and lists.
 */
@RestControllerAdvice
public class CamelCaseResponseAdvice implements ResponseBodyAdvice<Object> {

    @Override
    public boolean supports(MethodParameter returnType,
                            Class<? extends HttpMessageConverter<?>> converterType) {
        return true;
    }

    @Override
    public Object beforeBodyWrite(Object body,
                                  MethodParameter returnType,
                                  MediaType selectedContentType,
                                  Class<? extends HttpMessageConverter<?>> selectedConverterType,
                                  ServerHttpRequest request,
                                  ServerHttpResponse response) {
        return deepCamelCase(body);
    }

    @SuppressWarnings("unchecked")
    private Object deepCamelCase(Object obj) {
        if (obj == null) return null;
        if (obj instanceof Map<?, ?> map) {
            Map<String, Object> result = new LinkedHashMap<>();
            map.forEach((k, v) -> result.put(snakeToCamel(k.toString()), deepCamelCase(v)));
            return result;
        }
        if (obj instanceof List<?> list) {
            return list.stream().map(this::deepCamelCase).collect(Collectors.toList());
        }
        return obj;
    }

    private String snakeToCamel(String key) {
        if (!key.contains("_")) return key;
        String[] parts = key.split("_");
        StringBuilder sb = new StringBuilder(parts[0]);
        for (int i = 1; i < parts.length; i++) {
            if (!parts[i].isEmpty()) {
                sb.append(Character.toUpperCase(parts[i].charAt(0)));
                sb.append(parts[i].substring(1));
            }
        }
        return sb.toString();
    }
}
