package com.smartlaundromat.reporting.controller;

import com.smartlaundromat.reporting.service.FeedbackService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/admin/feedback")
@RequiredArgsConstructor
public class FeedbackController {

    private final FeedbackService feedbackService;

    @GetMapping
    public Map<String, Object> list(
            @RequestParam(required = false) Integer rating,
            @RequestParam(required = false) String machineId,
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate,
            @RequestParam(required = false, defaultValue = "false") boolean hasComment,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) {
        return feedbackService.list(rating, machineId, startDate, endDate, hasComment, page, size);
    }

    @GetMapping("/analytics")
    public Map<String, Object> analytics(
            @RequestParam(required = false) String startDate,
            @RequestParam(required = false) String endDate) {
        return feedbackService.analytics(startDate, endDate);
    }
}
