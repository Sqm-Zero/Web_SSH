package com.kklsqm.webssh.domain;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * 功能: ssh服务
 * 作者: 沙琪马
 * 日期: 2025/8/20 10:24
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
@TableName("servers")
public class SshService {
    @TableId(value = "id", type = IdType.AUTO)
    private Integer id;
    private String name;
    private String host;
    private Integer port;
    private String username;
    private String password;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
