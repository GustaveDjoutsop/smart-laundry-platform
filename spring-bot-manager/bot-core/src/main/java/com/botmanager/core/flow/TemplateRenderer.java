package com.botmanager.core.flow;

import com.github.mustachejava.DefaultMustacheFactory;
import com.github.mustachejava.Mustache;
import com.github.mustachejava.MustacheFactory;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.io.StringReader;
import java.io.StringWriter;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@Component
public class TemplateRenderer {

    private final MustacheFactory mustacheFactory = new DefaultMustacheFactory();

    private final Map<String, Mustache> templateCache = new ConcurrentHashMap<>();

    public String render(String template, Map<String, Object> context) {
        if (template == null || template.isBlank()) {
            return "";
        }

        try {
            Mustache mustache = templateCache.computeIfAbsent(template, t ->
                    mustacheFactory.compile(new StringReader(t), "inline-" + t.hashCode())
            );

            StringWriter writer = new StringWriter();
            mustache.execute(writer, context);

            return writer.toString();
        } catch (Exception exception) {
            log.warn("Template rendering failed: {}", exception.getMessage());

            return template;
        }
    }

}
