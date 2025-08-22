package com.kklsqm.webssh.domain.dto;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 功能: 删除文件请求
 * 作者: 沙琪马
 * 日期: 2025/8/22 16:05
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class DeleteRequest {
    private String path;
    private boolean isDirectory;
}
