package com.kklsqm.webssh.controller;

import com.kklsqm.webssh.common.SSHConnectionManager;
import com.kklsqm.webssh.service.SshServiceService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;

/**
 * DashboardController 测试类
 * 测试新增的 Docker 容器操作和系统信息接口
 */
class DashboardControllerTest {

    @Mock
    private SshServiceService sshServiceService;

    @Mock
    private SSHConnectionManager connectionManager;

    private DashboardController dashboardController;

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        dashboardController = new DashboardController();
        // 使用反射设置私有字段
        try {
            var sshServiceField = DashboardController.class.getDeclaredField("serverService");
            sshServiceField.setAccessible(true);
            sshServiceField.set(dashboardController, sshServiceService);

            var connectionManagerField = DashboardController.class.getDeclaredField("connectionManager");
            connectionManagerField.setAccessible(true);
            connectionManagerField.set(dashboardController, connectionManager);
        } catch (Exception e) {
            throw new RuntimeException("Failed to set up test", e);
        }
    }

    @Test
    void testGetSystemInfo_ServerNotFound() {
        // 模拟服务器未找到
        when(sshServiceService.getById(anyLong())).thenReturn(null);

        ResponseEntity<Map<String, Object>> response = dashboardController.getSystemInfo(1L);

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertFalse((Boolean) response.getBody().get("success"));
        assertEquals("服务器未找到", response.getBody().get("message"));
    }

    @Test
    void testContainerAction_InvalidAction() {
        // 测试不支持的操作类型
        ResponseEntity<Map<String, Object>> response = dashboardController.containerAction(1L, "container123", "invalid");

        assertEquals(HttpStatus.BAD_REQUEST, response.getStatusCode());
        assertNotNull(response.getBody());
        assertFalse((Boolean) response.getBody().get("success"));
        assertEquals("不支持的操作类型: invalid", response.getBody().get("message"));
    }

    @Test
    void testContainerAction_ServerNotFound() {
        // 模拟服务器未找到
        when(sshServiceService.getById(anyLong())).thenReturn(null);

        ResponseEntity<Map<String, Object>> response = dashboardController.containerAction(1L, "container123", "start");

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertFalse((Boolean) response.getBody().get("success"));
        assertEquals("服务器未找到", response.getBody().get("message"));
    }

    @Test
    void testGetContainerLogs_ServerNotFound() {
        // 模拟服务器未找到
        when(sshServiceService.getById(anyLong())).thenReturn(null);

        ResponseEntity<Map<String, Object>> response = dashboardController.getContainerLogs(1L, "container123", 50);

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertFalse((Boolean) response.getBody().get("success"));
        assertEquals("服务器未找到", response.getBody().get("message"));
    }

    @Test
    void testGetContainerDetails_ServerNotFound() {
        // 模拟服务器未找到
        when(sshServiceService.getById(anyLong())).thenReturn(null);

        ResponseEntity<Map<String, Object>> response = dashboardController.getContainerDetails(1L, "container123");

        assertEquals(HttpStatus.OK, response.getStatusCode());
        assertNotNull(response.getBody());
        assertFalse((Boolean) response.getBody().get("success"));
        assertEquals("服务器未找到", response.getBody().get("message"));
    }

    @Test
    void testValidActions() {
        // 测试支持的操作类型
        String[] validActions = {"start", "stop", "restart"};
        
        for (String action : validActions) {
            // 这里只测试参数验证，不测试实际的SSH连接
            when(sshServiceService.getById(anyLong())).thenReturn(null);
            
            ResponseEntity<Map<String, Object>> response = dashboardController.containerAction(1L, "container123", action);
            
            // 由于服务器未找到，应该返回服务器未找到的错误，而不是操作类型错误
            assertEquals(HttpStatus.OK, response.getStatusCode());
            assertNotNull(response.getBody());
            assertFalse((Boolean) response.getBody().get("success"));
            assertEquals("服务器未找到", response.getBody().get("message"));
        }
    }
}
