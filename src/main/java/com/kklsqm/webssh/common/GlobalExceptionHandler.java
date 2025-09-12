package com.kklsqm.webssh.common;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ControllerAdvice;
import org.springframework.web.bind.annotation.ExceptionHandler;

import java.util.HashMap;
import java.util.Map;

/**
 * 功能: 全局异常捕获器
 * 作者: 沙琪马
 * 日期: 2025/9/12 10:54
 */
@ControllerAdvice
public class GlobalExceptionHandler {

    // 其他异常的处理（通用异常）
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGeneralException(Exception ex) {
        Map<String, Object> response = new HashMap<>();
        response.put("success", false);
        response.put("message", "系统内部错误"); // 避免暴露敏感信息
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
    }
}
